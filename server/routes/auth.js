
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../config/db");

const jwt = require("jsonwebtoken");
const authenticateToken = require("../middleware/authMiddleware");
const router = express.Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    // Validate required fields
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required.",
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must contain between 1 and 100 characters.",
      });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      cleanEmail.length > 191 ||
      !emailPattern.test(cleanEmail)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters and no more than 72 UTF-8 bytes.",
      });
    }

    // Hash the password before saving it
    const passwordHash = await bcrypt.hash(password, 12);

    // Save the new user using a parameterized query
    const [result] = await db.execute(
      `INSERT INTO users (name, email, password_hash)
       VALUES (?, ?, ?)`,
      [cleanName, cleanEmail, passwordHash]
    );

    // Never return the password or password hash
    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      user: {
        id: result.insertId,
        name: cleanName,
        email: cleanEmail,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Registration failed due to a server error.",
    });
  }
});


router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
  
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !email.trim() ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required.",
        });
      }
  
      const cleanEmail = email.trim().toLowerCase();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
      if (
        cleanEmail.length > 191 ||
        !emailPattern.test(cleanEmail) ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid email or password format.",
        });
      }
  
      const jwtSecret = process.env.JWT_SECRET;
  
      if (!jwtSecret) {
        console.error("JWT_SECRET is not configured.");
  
        return res.status(500).json({
          success: false,
          message: "Authentication is not configured on the server.",
        });
      }
  
      // Find the user by email
      const [rows] = await db.execute(
        `SELECT id, name, email, password_hash
         FROM users
         WHERE email = ?
         LIMIT 1`,
        [cleanEmail]
      );
  
      if (rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password.",
        });
      }
  
      const user = rows[0];
  
      // Compare the submitted password with the stored bcrypt hash
      const passwordMatches = await bcrypt.compare(
        password,
        user.password_hash
      );
  
      if (!passwordMatches) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password.",
        });
      }
  
      // Issue a signed token after successful authentication
      const token = jwt.sign(
        { sub: String(user.id) },
        jwtSecret,
        { expiresIn: "1h" }
      );
  
      return res.status(200).json({
        success: true,
        message: "Login successful.",
        token,
        expiresIn: "1h",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      });
    } catch (error) {
      console.error("Login error:", error.message);
  
      return res.status(500).json({
        success: false,
        message: "Login failed due to a server error.",
      });
    }
  });

  
router.get("/me", authenticateToken, async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT id, name, email, created_at
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [req.user.sub]
      );
  
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User account not found.",
        });
      }
  
      return res.status(200).json({
        success: true,
        user: rows[0],
      });
    } catch (error) {
      console.error("Profile lookup error:", error.message);
  
      return res.status(500).json({
        success: false,
        message: "Unable to retrieve the user profile.",
      });
    }
  });
  
  

module.exports = router;
