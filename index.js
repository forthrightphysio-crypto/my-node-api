const express = require("express");
const admin = require("firebase-admin"); // ← only once

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

console.log('Firebase initialized successfully!');

// 🔹 Test route
app.get("/", (req, res) => {
  res.send("✅ FCM Server is running");
});

// 🔹 Send notification route
app.post("/send", async (req, res) => {
  const { token, title, body } = req.body;

  if (!token || !title || !body) {
    return res.status(400).send("Missing fields");
  }

  const message = {
    notification: { title, body },
    token,
  };

  try {
    await admin.messaging().send(message);
    res.send("✅ Notification sent successfully!");
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).send("Error sending message");
  }
});

// 🔹 Schedule notification route
app.post("/schedule", async (req, res) => {
  const { token, title, body, date, time } = req.body;

  if (!token || !title || !body || !date || !time) {
    return res.status(400).send("Missing required fields");
  }

  try {
    const scheduleDateTime = new Date(`${date}T${time}:00+05:30`);
    const now = new Date();
    const delay = scheduleDateTime - now;

    console.log(`🕒 Now: ${now.toLocaleString()}`);
    console.log(`🕒 Schedule Time (IST): ${scheduleDateTime.toLocaleString()}`);
    console.log(`⏳ Delay: ${delay / 1000} seconds`);

    if (delay <= 0) {
      return res.status(400).send("Scheduled time must be in the future");
    }

    console.log(`🕒 Notification scheduled for ${scheduleDateTime.toLocaleString()}`);
    console.log(`📦 Details → Title: "${title}", Body: "${body}", Token: ${token.substring(0, 10)}...`);

    setTimeout(async () => {
      const message = { notification: { title, body }, token };

      try {
        await admin.messaging().send(message);
        console.log(`✅ Notification SENT successfully at ${new Date().toLocaleString()}`);
      } catch (error) {
        // ✅ Handle invalid token
        if (error.code === 'messaging/registration-token-not-registered') {
          console.log("❌ Token is invalid, removing from Firestore:", token);
          try {
            await admin.firestore().collection('adminTokens').doc(token).delete();
            console.log("🗑 Token removed successfully.");
          } catch (deleteError) {
            console.error("❌ Failed to remove token from Firestore:", deleteError);
          }
        } else {
          console.error("❌ Error sending scheduled notification:", error);
        }
      }
    }, delay);

    res.send(`🕒 Notification scheduled for ${scheduleDateTime.toLocaleString()}`);
  } catch (error) {
    console.error("❌ Scheduling error:", error);
    res.status(500).send("Error scheduling notification");
  }
});

// 🔹 Send notification to all admins
// 🔹 Fetch all admin tokens
app.get("/adminTokens", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("adminTokens").get();

    if (snapshot.empty) {
      return res.status(200).json({ tokens: [], message: "No admin tokens found" });
    }

    // Collect document IDs (the tokens)
    const tokens = snapshot.docs.map(doc => doc.id);

    res.status(200).json({ tokens });
  } catch (error) {
    console.error("❌ Error fetching admin tokens:", error);
    res.status(500).json({ error: "Error fetching admin tokens" });
  }
});
// 🔹 Send notification to all admins
app.post("/notify-admins", async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).send("Missing title or body");

  try {
    const snapshot = await admin.firestore().collection('adminTokens').get();
    const tokens = snapshot.docs.map(doc => doc.id).filter(Boolean);
    if (!tokens.length) return res.status(200).send("No admin tokens available");

    const message = { notification: { title, body }, tokens };
    const response = await admin.messaging().sendMulticast(message);

    console.log(`✅ Sent to ${response.successCount}/${tokens.length} admins`);
    res.send(`✅ Notifications sent to ${response.successCount} admins`);
  } catch (error) {
    console.error("❌ Error sending admin notifications:", error);
    res.status(500).json({ message: "Error sending notifications", error: error.message });
  }
});




// 🔹 Start server
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));

