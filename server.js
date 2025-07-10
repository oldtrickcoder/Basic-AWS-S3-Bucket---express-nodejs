require("dotenv").config(); // Memuat variabel lingkungan dari .env

const express = require("express");
const AWS = require("aws-sdk");
const multer = require("multer");
const path = require("path");

const app = express();
const port = 3000;

// Konfigurasi AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Middleware untuk parsing JSON body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Konfigurasi Multer untuk mengunggah file ke memori (tidak disimpan di disk lokal)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Rute CRUD S3 ---

// 1. CREATE (Upload File)
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  const file = req.file;
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: `uploads/${Date.now()}_${file.originalname}`, // Nama file di S3
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: "private", // Pastikan ini private, tidak ada akses publik
  };

  try {
    const data = await s3.upload(params).promise();
    res.status(200).json({
      message: "File uploaded successfully!",
      location: data.Location,
      key: data.Key,
    });
  } catch (err) {
    console.error("Error uploading file:", err);
    res
      .status(500)
      .json({ error: "Failed to upload file", details: err.message });
  }
});

// 2. READ (List Files)
app.get("/files", async (req, res) => {
  const params = {
    Bucket: S3_BUCKET_NAME,
  };

  try {
    const data = await s3.listObjectsV2(params).promise();
    const files = data.Contents.map((item) => ({
      Key: item.Key,
      LastModified: item.LastModified,
      Size: item.Size,
    }));
    res.status(200).json(files);
  } catch (err) {
    console.error("Error listing files:", err);
    res
      .status(500)
      .json({ error: "Failed to list files", details: err.message });
  }
});

// 3. READ (Get a single file - download URL)
app.get("/files/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key); // Dekode key karena mungkin mengandung karakter khusus

  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: key,
  };

  try {
    // Ini akan mendapatkan URL sementara yang pre-signed untuk download
    // URL ini akan kedaluwarsa setelah waktu tertentu (default 900 detik = 15 menit)
    const url = s3.getSignedUrl("getObject", params);
    res.status(200).json({
      message: "Signed URL generated successfully",
      url: url,
      key: key,
    });
  } catch (err) {
    console.error("Error getting signed URL:", err);
    res.status(500).json({ error: "Failed to get file", details: err.message });
  }
});

// 4. DELETE (Delete File)
app.delete("/files/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key); // Dekode key

  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: key,
  };

  try {
    await s3.deleteObject(params).promise();
    res
      .status(200)
      .json({ message: `File with key '${key}' deleted successfully.` });
  } catch (err) {
    console.error("Error deleting file:", err);
    res
      .status(500)
      .json({ error: "Failed to delete file", details: err.message });
  }
});

// --- Server Start ---
app.listen(port, () => {
  console.log(`S3 CRUD app listening at http://localhost:${port}`);
  console.log(`S3 Bucket Name: ${S3_BUCKET_NAME}`);
  console.log(`AWS Region: ${process.env.AWS_REGION}`);
});
