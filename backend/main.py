import base64
import json
import os
import re
from datetime import datetime
from io import BytesIO
from typing import Optional

import httpx
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from motor.motor_asyncio import AsyncIOMotorClient
from PIL import Image
from pymongo.errors import ConnectionFailure

load_dotenv()

DATE_FORMAT = "%d-%m-%Y"
EMPTY_ANALYTICS = {
    "completion_rate": 0,
    "total_items": 0,
    "total_tasks": 0,
    "completed_tasks": 0,
    "type_distribution": {"TASK": 0, "EVENT": 0, "NOTE": 0},
    "status_distribution": {"TODO": 0, "IN_PROGRESS": 0, "DONE": 0, "SCHEDULED": 0},
    "productivity_trend": [],
    "active_days": 0,
    "current_streak": 0,
    "longest_streak": 0,
    "items_by_day_of_week": {},
}
GROQ_CHAT_MODEL = "openai/gpt-oss-120b"
GROQ_VLM_MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct"

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable is required. Please set it in your .env file.")

MONGODB_URL = os.getenv("MONGODB_URL")
if not MONGODB_URL:
    raise ValueError("MONGODB_URL environment variable is required. Please set it in your .env file.")

app = FastAPI(title="BuJo Companion API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mongodb_client: Optional[AsyncIOMotorClient] = None
database = None
groq_client = Groq(api_key=GROQ_API_KEY)


def scans_collection():
    return database.scans


def today_date_str() -> str:
    return datetime.now().strftime(DATE_FORMAT)


def strip_json_fences(text: str) -> str:
    return text.replace("```json", "").replace("```", "").strip()


def dedupe_by_content(items: list) -> list:
    seen = set()
    unique = []
    for item in items:
        content_key = item.get("content", "").lower().strip()
        if content_key and content_key not in seen:
            seen.add(content_key)
            unique.append(item)
    return unique


def parse_valid_date_or_today(date_text: str, fallback_today: str) -> str:
    try:
        datetime.strptime(date_text, DATE_FORMAT)
        return date_text
    except (TypeError, ValueError):
        return fallback_today


def ask_groq(prompt: str, model: str = GROQ_CHAT_MODEL) -> str:
    completion = groq_client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=1,
        top_p=1,
        stream=False,
        stop=None,
    )
    return completion.choices[0].message.content


def simple_markdown_to_html(text: str) -> str:
    text = re.sub(r"\n{2,}", "\n", text.strip())
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*\n]+?)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"```[\w]*\n?([\s\S]*?)```", r"\1", text)
    text = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        return f"<p>{text}</p>"
    return "".join(f"<p>{paragraph.replace(chr(10), '<br>')}</p>" for paragraph in paragraphs)


def serialize(doc):
    doc["_id"] = str(doc["_id"])
    return doc


@app.on_event("startup")
async def startup_db_client():
    global mongodb_client, database
    try:
        mongodb_client = AsyncIOMotorClient(MONGODB_URL)
        await mongodb_client.admin.command("ping")
        database = mongodb_client.bujo_companion
        try:
            await scans_collection().create_index("date", unique=True)
            print("✅ Created unique index on date field")
        except Exception as index_error:
            print(f"ℹ️ Index on date field: {index_error}")
        print("✅ Connected to MongoDB Atlas")
    except ConnectionFailure as error:
        print(f"❌ Failed to connect to MongoDB: {error}")
        raise


@app.on_event("shutdown")
async def shutdown_db_client():
    global mongodb_client
    if mongodb_client:
        mongodb_client.close()
        print("✅ Disconnected from MongoDB")


@app.get("/")
async def root():
    return {"message": "BuJo Companion API"}


@app.get("/api/scans")
async def get_scans():
    try:
        scans = []
        async for scan in scans_collection().find().sort("created_at", -1):
            scans.append(serialize(scan))
        return {"scans": scans}
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to fetch scans: {error}")


@app.get("/api/scans/{scan_id}")
async def get_scan(scan_id: str):
    try:
        scan = await scans_collection().find_one({"_id": ObjectId(scan_id)})
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to fetch scan: {error}")
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return serialize(scan)


@app.get("/api/scans/date/{date}")
async def get_scan_by_date(date: str):
    try:
        scan = await scans_collection().find_one({"date": date})
        if not scan:
            return {"date": date, "items": [], "created_at": None, "updated_at": None}
        return serialize(scan)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to fetch scan: {error}")


@app.get("/api/scans/dates/all")
async def get_all_dates():
    try:
        dates = []
        async for scan in scans_collection().find({}, {"date": 1, "_id": 0}).sort("date", 1):
            dates.append(scan["date"])
        return {"dates": dates}
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dates: {error}")


@app.get("/api/analytics")
async def get_analytics():
    try:
        all_items = []
        all_dates = []
        async for scan in scans_collection().find().sort("date", 1):
            scan_date = scan.get("date", "")
            all_dates.append(scan_date)
            for item in scan.get("items", []):
                item["date"] = scan_date
                all_items.append(item)

        if not all_items:
            return EMPTY_ANALYTICS

        tasks = [item for item in all_items if item.get("type") == "TASK"]
        total_tasks = len(tasks)
        completed_tasks = len([task for task in tasks if task.get("status") == "DONE"])
        completion_rate = (completed_tasks / total_tasks * 100) if total_tasks else 0

        type_counts = {"TASK": 0, "EVENT": 0, "NOTE": 0}
        status_counts = {"TODO": 0, "IN_PROGRESS": 0, "DONE": 0, "SCHEDULED": 0}
        date_counts = {}

        for item in all_items:
            item_type = item.get("type", "NOTE")
            if item_type in type_counts:
                type_counts[item_type] += 1
            item_status = item.get("status")
            if item_status in status_counts:
                status_counts[item_status] += 1
            item_date = item.get("date", "")
            date_counts[item_date] = date_counts.get(item_date, 0) + 1

        unique_dates = sorted(set(all_dates))
        productivity_trend = [{"date": d, "count": date_counts.get(d, 0)} for d in unique_dates[-30:]]
        active_days = len(unique_dates)

        current_streak = 0
        if unique_dates:
            date_set = set(unique_dates)
            check_date = datetime.now()
            while True:
                check_date_str = check_date.strftime(DATE_FORMAT)
                if check_date_str in date_set:
                    current_streak += 1
                    check_date = datetime(check_date.year, check_date.month, check_date.day - 1)
                else:
                    break

        longest_streak = 0
        if unique_dates:
            running_streak = 1
            for i in range(1, len(unique_dates)):
                try:
                    previous_date = datetime.strptime(unique_dates[i - 1], DATE_FORMAT)
                    current_date = datetime.strptime(unique_dates[i], DATE_FORMAT)
                    if (current_date - previous_date).days == 1:
                        running_streak += 1
                    else:
                        longest_streak = max(longest_streak, running_streak)
                        running_streak = 1
                except Exception:
                    pass
            longest_streak = max(longest_streak, running_streak)

        items_by_day = {
            "Monday": 0,
            "Tuesday": 0,
            "Wednesday": 0,
            "Thursday": 0,
            "Friday": 0,
            "Saturday": 0,
            "Sunday": 0,
        }
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        for date_str in unique_dates:
            try:
                day_name = day_names[datetime.strptime(date_str, DATE_FORMAT).weekday()]
                items_by_day[day_name] += date_counts.get(date_str, 0)
            except Exception:
                pass

        return {
            "completion_rate": round(completion_rate, 1),
            "total_items": len(all_items),
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "type_distribution": type_counts,
            "status_distribution": status_counts,
            "productivity_trend": productivity_trend,
            "active_days": active_days,
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "items_by_day_of_week": items_by_day,
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to fetch analytics: {error}")


async def merge_items_with_llm(existing_items: list, new_items: list, date: str) -> list:
    try:
        prompt = f"""Today's date is {today_date_str()}. You are merging bullet journal items for the specific journal date {date}.

Existing items in the database:
{json.dumps(existing_items, indent=2)}

Newly extracted items from a new scan:
{json.dumps(new_items, indent=2)}

Your task:
1. Merge these two lists intelligently
2. Remove duplicates (items with the same or very similar content)
3. Preserve all unique items from both lists
4. If an item exists in both lists but with different statuses, keep the more complete/updated version
5. Maintain the structure: each item should have type, status, and content fields
6. Return ONLY a valid JSON array with the merged items

Return the merged items as a JSON array matching this schema:
[
  {{ 
    "type": "TASK"|"EVENT"|"NOTE", 
    "status": "TODO"|"DONE"|"IN_PROGRESS"|"SCHEDULED", 
    "content": "string",
    "subtasks": [
      {{ "type": "...", "status": "...", "content": "string" }}
    ]
  }}
]

Do not include any markdown formatting or explanations, just the JSON array."""

        merged_items = json.loads(strip_json_fences(ask_groq(prompt)))
        if isinstance(merged_items, list):
            return merged_items
        if isinstance(merged_items, dict) and "items" in merged_items:
            return merged_items["items"]
        raise ValueError("LLM response is not a valid array")
    except json.JSONDecodeError as error:
        print(f"⚠️ Failed to parse LLM merge response: {error}")
        return dedupe_by_content(existing_items + new_items)
    except Exception as error:
        print(f"⚠️ Error merging items with LLM: {error}")
        return dedupe_by_content(existing_items + new_items)


@app.post("/api/process-image")
async def process_image(file: UploadFile = File(...)):
    try:
        today = today_date_str()
        image_bytes = await file.read()
        image = Image.open(BytesIO(image_bytes))
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        encoded_image = base64.b64encode(buffer.getvalue()).decode()

        prompt = f"""Extract tasks, events, and notes from this bullet journal page. Also extract the date from the page in DD-MM-YYYY format. If no date is visible on the page, use today's date: {today}.

Return ONLY a valid JSON object with this structure:
{{
  "date": "DD-MM-YYYY",
  "items": [
    {{ 
      "type": "TASK"|"EVENT"|"NOTE", 
      "status": "TODO"|"DONE"|"IN_PROGRESS"|"SCHEDULED", 
      "content": "string"
    }}
  ]
}}

Map symbols carefully: '•', '.' or 'Dot' = TASK(TODO); 'X' = TASK(DONE); '/' = TASK(IN_PROGRESS); 'O' = EVENT(SCHEDULED); 'Filled O', 'Solid Circle' or 'ø' = EVENT(DONE).

Do not include any markdown formatting or explanations, just the JSON."""

        payload = {
            "model": GROQ_VLM_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded_image}"}},
                    ],
                }
            ],
            "temperature": 0.1,
            "max_tokens": 1024,
            "response_format": {"type": "json_object"},
        }

        headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=60.0,
            )

        if not response.is_success:
            error_data = response.json()
            raise HTTPException(
                status_code=response.status_code,
                detail=error_data.get("error", {}).get("message", "Groq API Failed"),
            )

        response_data = response.json()
        content = response_data["choices"][0]["message"]["content"]
        print("=" * 80)
        print("GROQ VLM RESPONSE:")
        print("=" * 80)
        print(f"Full response data: {json.dumps(response_data, indent=2)}")
        print(f"Content: {content}")
        print("=" * 80)

        try:
            parsed = json.loads(strip_json_fences(content))
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Failed to parse VLM response: {error}")

        extracted_items = []
        extracted_date = today
        if isinstance(parsed, dict):
            extracted_date = parse_valid_date_or_today(parsed.get("date"), today)
            if isinstance(parsed.get("items"), list):
                extracted_items = parsed["items"]
            else:
                for key, value in parsed.items():
                    if key != "date" and isinstance(value, list):
                        extracted_items = value
                        break
        elif isinstance(parsed, list):
            extracted_items = parsed

        scan_id = None
        saved_to_db = False
        final_items = extracted_items

        try:
            existing_doc = await scans_collection().find_one({"date": extracted_date})
            if existing_doc:
                print(f"📝 Document exists for date {extracted_date}, merging items...")
                final_items = await merge_items_with_llm(existing_doc.get("items", []), extracted_items, extracted_date)
                update_result = await scans_collection().update_one(
                    {"date": extracted_date},
                    {"$set": {"items": final_items, "updated_at": datetime.utcnow()}},
                )
                if update_result.modified_count > 0 or update_result.matched_count > 0:
                    saved_to_db = True
                    scan_id = str(existing_doc["_id"])
                    print(f"✅ Updated existing document for date {extracted_date} with merged items")
                else:
                    print("⚠️ Warning: Update operation did not modify any documents")
            else:
                result = await scans_collection().insert_one(
                    {
                        "date": extracted_date,
                        "items": extracted_items,
                        "created_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow(),
                    }
                )
                if result.inserted_id:
                    saved_to_db = True
                    scan_id = str(result.inserted_id)
                    print(f"✅ Created new document for date {extracted_date} with ID: {scan_id}")
                else:
                    print("⚠️ Warning: Insert operation did not return an ID")
        except Exception as error:
            print(f"❌ Error: Failed to save to MongoDB: {error}")
            import traceback

            traceback.print_exc()

        return {"date": extracted_date, "items": final_items, "scan_id": scan_id, "saved_to_db": saved_to_db}

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Error processing image: {error}")


@app.post("/api/query")
async def query_documents(query: dict = Body(...)):
    try:
        question = query.get("question", "")
        if not question:
            raise HTTPException(status_code=400, detail="Question is required")

        documents = []
        async for scan in scans_collection().find().sort("date", 1):
            documents.append({"date": scan.get("date", ""), "items": scan.get("items", [])})

        lines = ["All Bullet Journal Entries:", ""]
        for doc in documents:
            lines.append(f"Date: {doc['date']}")
            lines.append("Items:")
            for item in doc["items"]:
                item_type = item.get("type", "UNKNOWN")
                item_status = item.get("status", "")
                item_content = item.get("content", "")
                status_text = f" ({item_status})" if item_status else ""
                lines.append(f"  - [{item_type}]{status_text}: {item_content}")
            lines.append("")

        formatted_entries = "\n".join(lines)
        prompt = f"""Today's date is {today_date_str()}.

{formatted_entries}

User Question: {question}

Please provide a helpful answer based on the bullet journal entries above. 
IMPORTANT INSTRUCTIONS:
- Be very concise and relevant and respond in natural, conversational language as the response will be read out aloud
- Do NOT use markdown formatting (no #, **, *, `, etc.)
- You may use HTML tags like <p>, <strong>, <em>, <ul>, <li>, <br> for structure if needed
- Use SINGLE line breaks for items within a list or category
- Only use DOUBLE line breaks to separate major sections
- Keep the response tightly spaced and avoid unnecessary gaps between related lines"""

        return {"response": simple_markdown_to_html(ask_groq(prompt)), "documents_count": len(documents)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Error querying documents: {error}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
