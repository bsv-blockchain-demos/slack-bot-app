const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

// Use environment variable for MongoDB URI or fallback to hardcoded value
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Database and collections
let db;
let threadsCollection;

// Connect to MongoDB
async function connectToMongo() {
  if (!db) {
    try {
      // Connect the client to the server
      await client.connect();
      console.log("Connected to MongoDB!");
      
      // Initialize database and collections
      db = client.db("slackApp");
      threadsCollection = db.collection("threads");
      usersCollection = db.collection("users");
      
      // Create indexes for better performance
      await threadsCollection.createIndex({ "_id": 1 }); // Thread ID (thread_ts)
      await threadsCollection.createIndex({ "channel": 1 }); // Channel ID
      await threadsCollection.createIndex({ "saved_by": 1 }); // User who saved

      await usersCollection.createIndex({ id: 1 }, { unique: true });
      
      console.log("MongoDB indexes created successfully");
    } catch (error) {
      console.error("Error connecting to MongoDB:", error);
      throw error;
    }
  }
  return { db, threadsCollection, usersCollection };
}

// Connect immediately when this module is imported
connectToMongo().catch(console.error);

// Handle application shutdown
process.on('SIGINT', async () => {
  try {
    await client.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error during MongoDB shutdown:', error);
    process.exit(1);
  }
});

module.exports = { client, connectToMongo };