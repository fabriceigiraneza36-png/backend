require("dotenv").config();
const bcrypt = require("bcryptjs");
const { query } = require("./config/db");

async function updateAdmin() {
  const newEmail = "admin@altuvera.com";
  const newPassword = "123";
  
  const hash = await bcrypt.hash(newPassword, 12);
  
  await query(
    "UPDATE admin_users SET email = $1, password_hash = $2 WHERE username = $3",
    [newEmail, hash, "admin"]
  );
  
  console.log("Credentials updated!");
  console.log("Email: " + newEmail);
  console.log("Password: " + newPassword);
  
  process.exit(0);
}

updateAdmin();