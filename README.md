# BuJo Companion

A modern web application to digitize your analog bullet journal pages using AI vision.

## Project Structure

```
BuJo/
├── backend/          # FastAPI backend
│   ├── venv/        # Python virtual environment
│   ├── main.py      # FastAPI application
│   └── requirements.txt
└── frontend/         # Next.js frontend
    ├── app/         # Next.js app directory
    ├── package.json
    └── ...
```

## Getting Started

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Activate the virtual environment:
   ```bash
   # Windows
   .\venv\Scripts\activate
   
   # Linux/Mac
   source venv/bin/activate
   ```

3. Create a `.env` file in the backend directory and add your configuration:
   ```bash
   GROQ_API_KEY=your_groq_api_key_here
   MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
   ```
   
   To get your MongoDB Atlas connection string:
   - Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
   - Create a cluster (or use an existing one)
   - Click "Connect" → "Connect your application"
   - Copy the connection string and replace `<password>` with your database password

4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

5. Run the server:
   ```bash
   python main.py
   ```

The backend will run on `http://localhost:8000`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

The frontend will run on `http://localhost:3000`

## Usage

1. Make sure your Groq API key and MongoDB connection string are set in the backend `.env` file
2. Upload or drag & drop a bullet journal page image
3. Click "Extract Items" to process the image
4. Review and edit the extracted items
5. The extracted data is automatically saved to MongoDB Atlas

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: FastAPI, Python
- **Database**: MongoDB Atlas
- **AI**: Groq VLM (Llama 4 Maverick)

