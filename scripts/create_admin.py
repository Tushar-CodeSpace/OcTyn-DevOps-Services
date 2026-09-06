import os
import uuid
import bcrypt
from datetime import datetime, timezone
from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://root:rootpassword@mongodb:27017/?authSource=admin")
MONGO_DB = os.environ.get("MONGO_DB", "central_monitoring")

def create_admin():
    print(f"Connecting to MongoDB at {MONGO_URL}...")
    client = MongoClient(MONGO_URL)
    db = client[MONGO_DB]
    
    email = "admin@monitoring.com"
    password = "admin123"
    
    existing = db.users.find_one({"email": email})
    if existing:
        print(f"✅ Admin user already exists: {email}")
    else:
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        doc = {
            "_id": str(uuid.uuid4()),
            "email": email,
            "password_hash": password_hash,
            "name": "Demo Admin",
            "role": "super_admin",
            "created_at": datetime.now(timezone.utc),
        }
        db.users.insert_one(doc)
        print(f"🎉 Admin user successfully created!")
        print(f"   Email: {email}")
        print(f"   Password: {password}")

if __name__ == "__main__":
    create_admin()
