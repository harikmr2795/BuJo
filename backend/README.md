# BuJo Companion Backend

FastAPI backend for the BuJo Companion application.

## Setup

1. Activate the virtual environment:
   ```bash
   # Windows
   .\venv\Scripts\activate
   
   # Linux/Mac
   source venv/bin/activate
   ```

2. Create a `.env` file in the backend directory and add your configuration:
   ```bash
   GROQ_API_KEY=your_groq_api_key_here
   MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
   ```
   
   To get your MongoDB Atlas connection string:
   - Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
   - Create a cluster (or use an existing one)
   - Click "Connect" → "Connect your application"
   - Copy the connection string and replace `<password>` with your database password
   - Optionally add a database name at the end: `mongodb+srv://.../?retryWrites=true&w=majority` → `mongodb+srv://.../bujo_companion?retryWrites=true&w=majority`

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Run the server:
   ```bash
   python main.py
   ```
   
   Or using uvicorn directly:
   ```bash
   uvicorn main:app --reload
   ```

The API will be available at `http://localhost:8000`

## API Endpoints

- `GET /` - Health check
- `POST /api/process-image` - Process an image using Groq VLM and save to MongoDB
  - Body: Form data with `file` (image file)
  - Returns: `{ "date": "DD-MM-YYYY", "items": [...], "scan_id": "..." }`
  - **Behavior**: 
    - Uses date as unique identifier (one document per date)
    - If no document exists for the extracted date, creates a new one
    - If a document already exists, merges new items with existing items using Groq LLM (gpt-oss-120b model)
    - The merge process intelligently deduplicates and combines items
  - Note: The Groq API key is read from the `.env` file
- `GET /api/scans` - Get all stored scans
  - Returns: `{ "scans": [...] }`
  - Sorted by most recent first
- `GET /api/scans/{scan_id}` - Get a specific scan by ID
  - Returns: Scan document with date, items, and timestamps
- `GET /api/scans/date/{date}` - Get a scan by date (DD-MM-YYYY format)
  - Example: `GET /api/scans/date/25-12-2024`
  - Returns: Scan document for the specified date (returns empty items array if not found)
- `GET /api/scans/dates/all` - Get all dates that have scans, sorted chronologically
  - Returns: `{ "dates": ["DD-MM-YYYY", ...] }`
  - Used for date navigation in the frontend

