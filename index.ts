import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import {
  MongoClient,
  ServerApiVersion,
} from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("DineSpot server is running!");
});

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    "MONGODB_URI is missing in the .env file.",
  );
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const database = client.db("dinespot");

    const restaurantCollection =
      database.collection("restaurants");

    const reservationCollection =
      database.collection("reservations");

    const reviewCollection =
      database.collection("reviews");

    const userCollection =
      database.collection("users");

    const sessionCollection =
      database.collection("sessions");

    // Restaurant, reservation, review এবং user API routes


    // await client
    //   .db("admin")
    //   .command({ ping: 1 });

    console.log(
      "DineSpot database is ready!",
    );


    void restaurantCollection;
    void reservationCollection;
    void reviewCollection;
    void userCollection;
    void sessionCollection;
  } finally {
  
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(
    `DineSpot server running on port ${port}`,
  );
});