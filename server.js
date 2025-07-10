require("dotenv").config(); // Memuat variabel lingkungan dari .env

const express = require("express");
const AWS = require("aws-sdk");
const multer = require("multer");
const path = require("path");
const morgan = require("morgan");
const app = express();
const port = 3000;
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
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
app.use(cors());
// Konfigurasi Multer untuk mengunggah file ke memori (tidak disimpan di disk lokal)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const uploadMultiple = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Optional: Limit individual file size (e.g., 10MB)
}).array("files", 10);
app.use(morgan("tiny"));
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

// Multiple Files Upload
app.post("/BulkUpload", uploadMultiple, async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files uploaded.");
  }

  const files = req.files;
  console.log(files);
  const uploadPromises = files.map((file) => {
    // Optional: Generate a unique filename for each file
    const uniqueFileName = `${uuidv4()}-${file.originalname}`;
    const s3Key = "uploads/" + uniqueFileName; // This will be the name of the file in your S3 bucket

    const uploadParams = {
      Bucket: S3_BUCKET_NAME,
      Key: s3Key, // File name in S3
      Body: file.buffer, // File content as a buffer
      ContentType: file.mimetype, // Set the content type
    };

    // Return the promise for each S3 upload operation
    return s3
      .upload(uploadParams)
      .promise()
      .then((data) => ({
        fileName: file.originalname,
        status: "fulfilled",
        location: data.Location,
        key: data.Key,
      }))
      .catch((error) => ({
        fileName: file.originalname,
        status: "rejected",
        error: error.message,
      }));
  });

  try {
    // Execute all upload promises concurrently
    const results = await Promise.all(uploadPromises);

    // Separate successful and failed uploads
    const successfulUploads = results.filter(
      (result) => result.status === "fulfilled"
    );
    const failedUploads = results.filter(
      (result) => result.status === "rejected"
    );

    // Determine the overall status code
    const statusCode =
      failedUploads.length > 0
        ? successfulUploads.length > 0
          ? 207
          : 500 // 207 Multi-Status if some failed, 500 if all failed
        : 200; // 200 OK if all succeeded

    // Send a consolidated response
    res.status(statusCode).json({
      message:
        failedUploads.length > 0
          ? "Some files failed to upload."
          : "All files uploaded successfully!",
      successful: successfulUploads,
      failed: failedUploads,
    });
  } catch (err) {
    // This catch block would primarily handle errors in the Promise.all setup itself,
    // individual upload errors are caught within the map function's catch.
    console.error("Error processing multiple uploads:", err);
    res.status(500).send("An error occurred while processing uploads.");
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
// ONLY HAPPENED At Nodejs V.20
// app.get("/files/uploads/:id", async (req, res) => {
//   //   const { folder, keyparam } = req.params;
//   //   console.log(folder, keyparam);
//   const key = decodeURIComponent("uploads/" + req.params.id); // Dekode key karena mungkin mengandung karakter khusus
//   console.log(key, "....INI KEYS ......");
//   const params = {
//     Bucket: S3_BUCKET_NAME,
//     Key: key,
//   };

//   try {
//     // Ambil metadata objek terlebih dahulu untuk mendapatkan ContentType
//     const headData = await s3.headObject(params).promise();
//     const contentType = headData.ContentType;
//     const fileSize = headData.ContentLength;

//     // Set header Content-Type dan Content-Disposition
//     res.setHeader("Content-Type", contentType);
//     res.setHeader("Content-Length", fileSize);
//     // Opsi: Jika Anda ingin memaksa download (bukan ditampilkan di browser)
//     // res.setHeader('Content-Disposition', `attachment; filename="${path.basename(key)}"`);

//     // Dapatkan stream objek dari S3 dan pipe langsung ke response Express
//     const s3Stream = s3.getObject(params).createReadStream();

//     s3Stream.on("error", (err) => {
//       console.error("Error streaming file from S3:", err);
//       if (err.code === "NoSuchKey") {
//         return res.status(404).send("File not found.");
//       }
//       res.status(500).send("Error retrieving file.");
//     });

//     s3Stream.pipe(res); // Mengalirkan data dari S3 langsung ke respons klien
//   } catch (err) {
//     console.error("Error getting file from S3:", err);
//     if (err.code === "NoSuchKey") {
//       return res.status(404).send("File not found.");
//     }
//     res.status(500).json({
//       statusCode: 500,
//       error: "Failed to get file",
//       details: err,
//     });
//   }
// });

app.get("/files/no-pipe/uploads/:id", async (req, res) => {
  const key = decodeURIComponent("uploads/" + req.params.id); // Dekode key karena mungkin mengandung karakter khusus

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

// Tambahkan endpoint baru ini
app.post("/get-signed-urls-batch", async (req, res) => {
  const { keys } = req.body; // Harapkan array of keys di body request

  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: "Array of keys is required." });
  }

  const signedUrls = [];
  for (const key of keys) {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Expires: 3600, // Durasi validitas URL dalam detik (misal: 1 jam)
    };
    try {
      const url = s3.getSignedUrl("getObject", params);
      signedUrls.push({ key: key, url: url });
    } catch (err) {
      console.error(`Error generating signed URL for ${key}:`, err);
      signedUrls.push({ key: key, error: "Failed to generate URL" }); // Laporkan error untuk key spesifik
    }
  }
  res.status(200).json(signedUrls);
});

// app.js
// ... (kode sebelumnya) ...

// Pastikan rute ini digunakan untuk mendapatkan pre-signed URL
app.get("/files/:s3Key(*)", async (req, res) => {
  // Ubah :key menjadi :s3Key untuk kejelasan
  // console.log("req.params:", req.params); // Untuk debugging
  const key = decodeURIComponent(req.params.s3Key); // Akses menggunakan nama parameter baru
  // console.log("Extracted Key:", key); // Untuk debugging

  if (!key || key === "undefined") {
    // Tambahkan validasi dasar
    return res.status(400).json({ error: "File key is missing or invalid." });
  }

  console.log(req.params.s3Key, ".....INI DATA KEY .......", key);

  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Expires: 3600, // URL akan berlaku selama 1 jam (3600 detik)
  };

  try {
    const url = s3.getSignedUrl("getObject", params);
    res.status(200).json({
      message: "Signed URL generated successfully",
      url: url,
      key: key,
    });
  } catch (err) {
    console.error("Error generating signed URL:", err);
    res
      .status(500)
      .json({ error: "Failed to generate signed URL", details: err.message });
  }
});

// ... (sisa kode app.js) ...
// 4. DELETE (Delete File) file inside uploads folder
app.delete("/files/uploads/:key", async (req, res) => {
  const key = decodeURIComponent("uploads/" + req.params.key); // Dekode key
  //   const key = decodeURIComponent(req.params.key); // Dekode key

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

// Tambahkan endpoint baru ini
app.post("/get-signed-urls-batch", async (req, res) => {
  const { keys } = req.body; // Harapkan array of keys di body request

  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: "Array of keys is required." });
  }

  const signedUrls = [];
  for (const key of keys) {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Expires: 3600, // Durasi validitas URL dalam detik (misal: 1 jam)
    };
    try {
      const url = s3.getSignedUrl("getObject", params);
      signedUrls.push({ key: key, url: url });
    } catch (err) {
      console.error(`Error generating signed URL for ${key}:`, err);
      signedUrls.push({ key: key, error: "Failed to generate URL" }); // Laporkan error untuk key spesifik
    }
  }
  res.status(200).json(signedUrls);
});

// --- Server Start ---
app.listen(port, () => {
  console.log(`S3 CRUD app listening at http://localhost:${port}`);
  console.log(`S3 Bucket Name: ${S3_BUCKET_NAME}`);
  console.log(`AWS Region: ${process.env.AWS_REGION}`);
});
