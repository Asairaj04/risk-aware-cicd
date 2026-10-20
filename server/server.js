
const express = require("express");

const db = require("./config/db");

const cors = require("cors");
require("dotenv").config();

const repositoryRoutes = require("./routes/repositoryRoutes");

const app = express();

const authRoutes = require("./routes/auth");
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

app.use("/api/repositories", repositoryRoutes);

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Interview Preparation Platform API is running!",
  });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT DATABASE() AS databaseName");

    res.json({
      success: true,
      message: "MySQL connected successfully!",
      database: rows[0].databaseName,
    });
  } catch (error) {
    console.error("Database connection error:", error.message);

    res.status(500).json({
      success: false,
      message: "Database connection failed.",
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
