const express = require("express");
const cors = require("cors");
const mysql2 = require("mysql2");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const nodemailer = require("nodemailer");
const csv = require("csv-parser");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// Multer Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage });

// Gmail Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "gadgevaishnavi2012@gmail.com",
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Railway MySQL Connection
const db = mysql2.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306
}).promise();

// Check Database Connection
db.query("SELECT 1")
  .then(() => {
    console.log("Database Connected Successfully");
  })
  .catch((err) => {
    console.error("Database Connection Failed:", err.message);
  });

// Home API
app.get("/", (req, res) => {
  res.send("Node server is running");
});

// Register API
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check email already exists
    const checkSql = "SELECT * FROM users WHERE email = ?";
    const [user] = await db.execute(checkSql, [email]);

    if (user.length > 0) {
      return res.status(400).json({
        message: "Email already exists"
      });
    }

    // Hash password
    let hashedPassword = await bcrypt.hash(password, 16);

    // Insert user
    const insertSql =
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

    await db.execute(insertSql, [
      name,
      email,
      hashedPassword
    ]);

    // Welcome Email
    const mailOptions = {
      from: "gadgevaishnavi2012@gmail.com",
      to: email,
      subject: "Welcome to Recipe Management System 🍳",
      text: `Hello ${name}, your registration is successful. Welcome to Recipe Management System!`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log("Mail Error:", error);
      } else {
        console.log("Welcome Email Sent");
      }
    });

    res.json({
      message: "Registration Successful"
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: err.message
    });
  }
});

// Login API
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const sql = "SELECT * FROM users WHERE email = ?";
    const [result] = await db.query(sql, [email]);

    if (result.length === 0) {
      return res.status(401).json({
        message: "Invalid Email or Password"
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(
      password,
      result[0].password
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid Email or Password"
      });
    }

    res.status(200).json({
      message: "Login Successful",

      user: {
        id: result[0].id,
        name: result[0].name,
        email: result[0].email
      }
    });

  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
});

// Add Recipe API
app.post(
  "/add-recipe",
  upload.single("image"),
  async (req, res) => {
    try {

      const {
        recipe_name,
        category,
        ingredients,
        instructions,
        cooking_time
      } = req.body;

      const image = req.file
        ? req.file.filename
        : null;

      const sql = `
        INSERT INTO recipes
        (
          recipe_name,
          category,
          ingredients,
          instructions,
          cooking_time,
          image
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      await db.execute(sql, [
        recipe_name,
        category,
        ingredients,
        instructions,
        cooking_time,
        image
      ]);

      res.status(200).json({
        message: "Recipe Added Successfully"
      });

    } catch (err) {
      res.status(500).json({
        message: err.message
      });
    }
  }
);

// Bulk Upload Recipes API
app.post(
  "/bulk-upload",
  upload.single("file"),
  async (req, res) => {
    try {

      if (!req.file) {
        return res.status(400).json({
          message: "Please select a CSV file"
        });
      }

      const recipes = [];

      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on("data", (row) => {

          recipes.push([
            row.recipe_name,
            row.category,
            row.ingredients,
            row.instructions,
            row.cooking_time,
            row.image
          ]);

        })
        .on("end", async () => {

          if (recipes.length === 0) {
            fs.unlinkSync(req.file.path);

            return res.status(400).json({
              message: "CSV file is empty"
            });
          }

          const sql = `
            INSERT INTO recipes
            (
              recipe_name,
              category,
              ingredients,
              instructions,
              cooking_time,
              image
            )
            VALUES ?
          `;

          await db.query(sql, [recipes]);

          fs.unlinkSync(req.file.path);

          res.json({
            message: `${recipes.length} recipes uploaded successfully`
          });

        });

    } catch (err) {

      console.log(err);

      res.status(500).json({
        message: err.message
      });

    }
  }
);

// View Recipes API
app.get("/recipes", async (req, res) => {
  try {

    const [recipes] = await db.execute(
      "SELECT * FROM recipes ORDER BY id DESC"
    );

    res.status(200).json(recipes);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});

// Delete Recipe API
app.delete("/delete-recipe/:id", async (req, res) => {
  try {

    const { id } = req.params;

    await db.execute(
      "DELETE FROM recipes WHERE id = ?",
      [id]
    );

    res.status(200).json({
      message: "Recipe Deleted Successfully"
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});

// Get Single Recipe API
app.get("/recipe/:id", async (req, res) => {
  try {

    const { id } = req.params;

    const [recipe] = await db.execute(
      "SELECT * FROM recipes WHERE id = ?",
      [id]
    );

    res.json(recipe[0]);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});

// Update Recipe API
app.put("/update-recipe/:id", async (req, res) => {
  try {

    const { id } = req.params;

    const {
      recipe_name,
      category,
      ingredients,
      instructions,
      cooking_time
    } = req.body;

    await db.execute(
      `UPDATE recipes
       SET recipe_name = ?,
           category = ?,
           ingredients = ?,
           instructions = ?,
           cooking_time = ?
       WHERE id = ?`,
      [
        recipe_name,
        category,
        ingredients,
        instructions,
        cooking_time,
        id
      ]
    );

    res.json({
      message: "Recipe Updated Successfully"
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});

// Favourite Recipe API
app.put("/favourite-recipe/:id", async (req, res) => {
  try {

    const { id } = req.params;

    await db.execute(
      "UPDATE recipes SET favourite = NOT favourite WHERE id = ?",
      [id]
    );

    res.json({
      message: "Favourite Updated Successfully"
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});

// Dashboard Counts API
app.get("/dashboard-counts", async (req, res) => {
  try {

    const [recipes] = await db.execute(
      "SELECT COUNT(*) AS totalRecipes FROM recipes"
    );

    const [categories] = await db.execute(
      "SELECT COUNT(DISTINCT category) AS totalCategories FROM recipes"
    );

    const [favourites] = await db.execute(
      "SELECT COUNT(*) AS totalFavourites FROM recipes WHERE favourite = 1"
    );

    res.json({
      totalRecipes: recipes[0].totalRecipes,
      totalCategories: categories[0].totalCategories,
      totalFavourites: favourites[0].totalFavourites
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});

// Railway PORT
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});