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

app.get("/admin-tokens", async (req, res) => {
  try {
    const tokensSnapshot = await admin.firestore().collection('adminTokens').get();

    if (tokensSnapshot.empty) {
      return res.status(200).send({ tokens: [] });
    }

    const tokenPromises = [];
    const tokenMap = new Map(); // To remove duplicates

    tokensSnapshot.forEach(doc => {
      const token = doc.id; // Assuming doc.id is the token
      if (!tokenMap.has(token)) {
        tokenMap.set(token, true);

        // Check if token is still valid using FCM dry run
        const message = { token, dryRun: true };
        tokenPromises.push(
          admin.messaging().send(message)
            .then(() => token) // token is valid
            .catch(err => {
              // If token invalid, remove from Firestore
              if (err.code === 'messaging/registration-token-not-registered') {
                console.log(`❌ Token invalid, removing: ${token}`);
                return admin.firestore().collection('adminTokens').doc(token).delete().then(() => null);
              } else {
                console.error('Error checking token:', err);
                return null;
              }
            })
        );
      }
    });

    const validTokens = (await Promise.all(tokenPromises)).filter(Boolean);

    res.status(200).send({ tokens: validTokens });
  } catch (error) {
    console.error("❌ Error fetching admin tokens:", error);
    res.status(500).send("Error fetching admin tokens");
  }
});

// 🔹 Start server
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));




// const express = require("express");
// const admin = require("firebase-admin");

// const app = express();
// app.use(express.json());

// // 🔹 Initialize Firebase Admin SDK
// const serviceAccount = require("./serviceAccountKey.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// // 🔹 Test route
// app.get("/", (req, res) => {
//   res.send("✅ FCM Server is running");
// });

// // 🔹 Send notification route
// app.post("/send", async (req, res) => {
//   const { token, title, body } = req.body;

//   if (!token || !title || !body) {
//     return res.status(400).send("Missing fields");
//   }

//   const message = {
//     notification: { title, body },
//     token,
//   };

//   try {
//     await admin.messaging().send(message);
//     res.send("✅ Notification sent successfully!");
//   } catch (error) {
//     console.error("❌ Error sending message:", error);
//     res.status(500).send("Error sending message");
//   }
// });

// // 🔹 Start server
// // 🔹 Start server
// const PORT = 3000;
// app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));

