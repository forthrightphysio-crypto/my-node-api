const express = require("express");
const admin = require("firebase-admin"); // Firebase Admin
const B2 = require("backblaze-b2"); // Backblaze B2
const multer = require("multer"); // For handling file uploads
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());

// 🔹 Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

console.log("Firebase initialized successfully!");

// 🔹 Initialize Backblaze B2
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
});

(async () => {
  try {
    await b2.authorize();
    console.log("Backblaze B2 initialized successfully!");
  } catch (error) {
    console.error("❌ B2 initialization error:", error);
  }
})();

// 🔹 Multer setup for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 🔹 Test route
app.get("/", (req, res) => {
  res.send("✅ FCM + B2 Server is running");
});

// 🔹 File upload route
app.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).send("No file uploaded");
  }

  try {
    // 🔹 Get upload URL
    const uploadUrlResponse = await b2.getUploadUrl({
      bucketId: process.env.B2_BUCKET_ID,
    });

    // 🔹 Upload file
    const uploadResponse = await b2.uploadFile({
      uploadUrl: uploadUrlResponse.data.uploadUrl,
      uploadAuthToken: uploadUrlResponse.data.authorizationToken,
      fileName: file.originalname,
      data: file.buffer,
    });

    const fileUrl = `https://f000.backblazeb2.com/file/${process.env.B2_BUCKET_NAME}/${file.originalname}`;

    console.log("✅ File uploaded:", file.originalname);
    res.json({ message: "File uploaded successfully", url: fileUrl });
  } catch (error) {
    console.error("❌ B2 upload error:", error);
    res.status(500).send("Error uploading file");
  }
});

app.get("/play/:filename", async (req, res) => {
  const fileName = req.params.filename;

  try {
    // 1️⃣ Get file info from B2
    const fileList = await b2.listFileNames({
      bucketId: process.env.B2_BUCKET_ID,
      startFileName: fileName,
      maxFileCount: 1,
    });

    if (!fileList.data.files.length) {
      return res.status(404).send("File not found");
    }

    const fileInfo = fileList.data.files[0];
    const fileId = fileInfo.fileId;
    const fileSize = fileInfo.contentLength;

    // 2️⃣ Range header for streaming
    const range = req.headers.range;
    if (!range) {
      // Chrome will try to load the entire file if no range
      // For large files, we can send first chunk or force range
      return res.status(416).send("Range header required for streaming");
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunkSize = end - start + 1;

    // 3️⃣ Download only required chunk from B2
    const downloadResponse = await b2.downloadFileById({
      fileId,
      range: `bytes=${start}-${end}`,
    });

    // 4️⃣ Set headers Chrome expects
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": fileInfo.contentType || "application/octet-stream",
    });

    // 5️⃣ Pipe chunk to browser
    downloadResponse.data.pipe(res);
  } catch (err) {
    console.error("Streaming error:", err);
    res.status(500).send("Error streaming file");
  }
});


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

    console.log("Tokens to send:", tokens);

    const results = await Promise.all(tokens.map(async (token) => {
      try {
        await admin.messaging().send({ notification: { title, body }, token });
        return { token, success: true };
      } catch (err) {
        console.error(`❌ Failed token ${token}:`, err.message);
        // Remove invalid token
        if (err.code === 'messaging/registration-token-not-registered') {
          await admin.firestore().collection('adminTokens').doc(token).delete();
          console.log(`🗑 Token removed: ${token}`);
        }
        return { token, success: false, error: err.message };
      }
    }));

    const successCount = results.filter(r => r.success).length;
    res.send(`✅ Notifications sent to ${successCount}/${tokens.length} admins`);

  } catch (error) {
    console.error("❌ Error sending admin notifications:", error);
    res.status(500).json({ message: "Error sending notifications", error: error.message });
  }
});


// 🔹 Schedule notification for ALL admins
app.post("/schedule-admins", async (req, res) => {
  const { title, body, date, time } = req.body;

  if (!title || !body || !date || !time) {
    return res
      .status(400)
      .send("Missing required fields: title, body, date, or time");
  }

  try {
    // 🔹 Get all admin tokens
    const snapshot = await admin.firestore().collection("adminTokens").get();
    const tokens = snapshot.docs.map((doc) => doc.id).filter(Boolean);

    if (!tokens.length) {
      return res.status(200).send("No admin tokens available");
    }

    // 🔹 Convert input date & time (IST)
    const scheduleDateTimeIST = new Date(`${date}T${time}:00+05:30`);
    const now = new Date();

    const delay = scheduleDateTimeIST.getTime() - now.getTime();

    // 🔹 Format both times in IST for clean logging
    const nowIST = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const scheduleIST = scheduleDateTimeIST.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });

    console.log(`🕒 Now (IST): ${nowIST}`);
    console.log(`🕒 Scheduled Time (IST): ${scheduleIST}`);
    console.log(`⏳ Delay: ${(delay / 1000).toFixed(2)} seconds for ${tokens.length} admins`);

    if (delay <= 0) {
      return res.status(400).send("Scheduled time must be in the future");
    }

    // 🔹 Schedule sending
    setTimeout(async () => {
      const sendTimeIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      console.log(`📢 Sending scheduled admin notifications at ${sendTimeIST}`);

      const results = await Promise.all(
        tokens.map(async (token) => {
          try {
            await admin.messaging().send({
              notification: { title, body },
              token,
            });
            return { token, success: true };
          } catch (err) {
            console.error(`❌ Failed token ${token}:`, err.code);
            if (err.code === "messaging/registration-token-not-registered") {
              await admin.firestore().collection("adminTokens").doc(token).delete();
              console.log(`🗑 Removed invalid token: ${token}`);
            }
            return { token, success: false };
          }
        })
      );

      const successCount = results.filter((r) => r.success).length;
      console.log(`✅ Sent to ${successCount}/${tokens.length} admins`);
    }, delay);

    // 🔹 Send response in IST
    res.send(
      `🕒 Notification scheduled for ${scheduleIST} (IST) to ${tokens.length} admins`
    );
  } catch (error) {
    console.error("❌ Error scheduling admin notifications:", error);
    res.status(500).send("Error scheduling admin notifications");
  }
});




// 🔹 Start server
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));

