const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// 🔹 Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

console.log("Firebase initialized successfully!");

// 🔹 Firebase Notification routes

// Send notification
app.post("/send", async (req, res) => {
  const { token, title, body } = req.body;
  if (!token || !title || !body) return res.status(400).send("Missing fields");

  try {
    await admin.messaging().send({ notification: { title, body }, token });
    res.send("✅ Notification sent successfully!");
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).send("Error sending message");
  }
});

// Schedule notification
app.post("/schedule", async (req, res) => {
  const { token, title, body, date, time } = req.body;
  if (!token || !title || !body || !date || !time) return res.status(400).send("Missing required fields");

  try {
    const scheduleDateTime = new Date(`${date}T${time}:00+05:30`);
    const delay = scheduleDateTime - new Date();

    if (delay <= 0) return res.status(400).send("Scheduled time must be in the future");

    setTimeout(async () => {
      try {
        await admin.messaging().send({ notification: { title, body }, token });
        console.log(`✅ Notification sent to ${token}`);
      } catch (error) {
        console.error("❌ Error sending scheduled notification:", error);
      }
    }, delay);

    res.send(`🕒 Notification scheduled for ${scheduleDateTime.toLocaleString()}`);
  } catch (error) {
    console.error("❌ Scheduling error:", error);
    res.status(500).send("Error scheduling notification");
  }
});

// Get all admin tokens
app.get("/adminTokens", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("adminTokens").get();
    const tokens = snapshot.docs.map(doc => doc.id);
    res.status(200).json({ tokens });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching admin tokens" });
  }
});

// Notify all admins immediately
app.post("/notify-admins", async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).send("Missing title or body");

  try {
    const snapshot = await admin.firestore().collection('adminTokens').get();
    const tokens = snapshot.docs.map(doc => doc.id).filter(Boolean);
    if (!tokens.length) return res.status(200).send("No admin tokens available");

    await Promise.all(tokens.map(async (token) => {
      try {
        await admin.messaging().send({ notification: { title, body }, token });
      } catch (err) {
        if (err.code === 'messaging/registration-token-not-registered') {
          await admin.firestore().collection('adminTokens').doc(token).delete();
        }
      }
    }));

    res.send(`✅ Notifications sent to ${tokens.length} admins`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error sending notifications");
  }
});

// Schedule notifications for all admins
app.post("/schedule-admins", async (req, res) => {
  const { title, body, date, time } = req.body;
  if (!title || !body || !date || !time) return res.status(400).send("Missing required fields");

  try {
    const snapshot = await admin.firestore().collection("adminTokens").get();
    const tokens = snapshot.docs.map(doc => doc.id).filter(Boolean);
    if (!tokens.length) return res.status(200).send("No admin tokens available");

    const scheduleDateTime = new Date(`${date}T${time}:00+05:30`);
    const delay = scheduleDateTime - new Date();
    if (delay <= 0) return res.status(400).send("Scheduled time must be in the future");

    setTimeout(async () => {
      await Promise.all(tokens.map(async (token) => {
        try {
          await admin.messaging().send({ notification: { title, body }, token });
        } catch (err) {
          if (err.code === 'messaging/registration-token-not-registered') {
            await admin.firestore().collection('adminTokens').doc(token).delete();
          }
        }
      }));
      console.log(`✅ Scheduled notifications sent at ${new Date().toLocaleString()}`);
    }, delay);

    res.send(`🕒 Notifications scheduled for ${scheduleDateTime.toLocaleString()} to ${tokens.length} admins`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error scheduling notifications for admins");
  }
});


app.post("/notify-users", async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).send("Missing title or body");

  try {
    const snapshot = await admin.firestore().collection('userTokens').get();
    const tokens = snapshot.docs.map(doc => doc.id).filter(Boolean);

    if (!tokens.length) return res.status(200).send("No user tokens available");

    await Promise.all(tokens.map(async (token) => {
      try {
        await admin.messaging().send({ notification: { title, body }, token });
      } catch (err) {
        if (err.code === 'messaging/registration-token-not-registered') {
          await admin.firestore().collection('userTokens').doc(token).delete();
        }
      }
    }));

    res.send(`✅ Notifications sent to ${tokens.length} users`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error sending notifications to users");
  }
});


app.post("/schedule-users", async (req, res) => {
  const { title, body, date, time } = req.body;
  if (!title || !body || !date || !time) return res.status(400).send("Missing required fields");

  try {
    const snapshot = await admin.firestore().collection('userTokens').get();
    const tokens = snapshot.docs.map(doc => doc.id).filter(Boolean);

    if (!tokens.length) return res.status(200).send("No user tokens available");

    const scheduleDateTime = new Date(`${date}T${time}:00+05:30`);
    const delay = scheduleDateTime - new Date();
    if (delay <= 0) return res.status(400).send("Scheduled time must be in the future");

    setTimeout(async () => {
      await Promise.all(tokens.map(async (token) => {
        try {
          await admin.messaging().send({ notification: { title, body }, token });
        } catch (err) {
          if (err.code === 'messaging/registration-token-not-registered') {
            await admin.firestore().collection('userTokens').doc(token).delete();
          }
        }
      }));
      console.log(`✅ Scheduled notifications sent to all users at ${new Date().toLocaleString()}`);
    }, delay);

    res.send(`🕒 Notifications scheduled for ${scheduleDateTime.toLocaleString()} to ${tokens.length} users`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error scheduling notifications for users");
  }
});


// 🔹 Start server
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
