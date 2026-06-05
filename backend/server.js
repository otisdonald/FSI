// ================= IMPORTS =================
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
 .then(() => console.log("✅ MongoDB Connected"))
 .catch(err => console.log("❌ Mongo Error:", err));

// ================= MODELS =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  startup: String,
  problem: String,
  solution: String,
  business_model: String,
  usage: String,
  paymentStatus: { type: String, default: "unpaid" },
  tx_ref: String,
  createdAt: { type: Date, default: Date.now }
}));

// ================= CONFIG =================
app.get("/api/config", (req, res) => {
  res.json({ transactpayPublicKey: process.env.TPAY_PUBLIC_KEY });
});

// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req, res) => {
  try {
    const data = req.body;
    await Application.findOneAndDelete({ email: data.email });
    const appData = await Application.create(data);
    res.json({ success: true, id: appData._id });
  } catch (err) {
    console.log("❌ Save error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= ENCRYPTION FUNCTION (TRANSACTPAY FINAL) =================
function encryptPayload(payload, encryptionKey) {
  try {
    // TransactPay requires SHA256 hash of your encryption key -> 32 bytes
    const key = crypto.createHash('sha256').update(encryptionKey).digest();

    // Use AES-256-ECB (no IV)
    const cipher = crypto.createCipheriv("aes-256-ecb", key, null);
    cipher.setAutoPadding(true);

    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // TransactPay expects { data: "encrypted_string" }
    return { data: encrypted };
  } catch (err) {
    console.log("❌ Encryption error:", err.message);
    throw err;
  }
}

// ================= INITIATE PAYMENT =================
app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;

  try {
    if (!process.env.TPAY_PUBLIC_KEY ||!process.env.TPAY_ENCRYPTION_KEY) {
      throw new Error("Missing TPAY_PUBLIC_KEY or TPAY_ENCRYPTION_KEY in environment");
    }

    const reference = "FSI-" + Date.now();

    const payload = {
      customer: {
        firstname: name.split(" ")[0] || name,
        lastname: name.split(" ")[1] || "",
        mobile: phone,
        country: "NG",
        email: email
      },
      order: {
        amount: 1000,
        reference: reference,
        description: "FSI Application Fee",
        currency: "NGN"
      },
      payment: {
        RedirectUrl: "https://fsi.onrender.com/pending.html"
      }
    };

    const encryptedPayload = encryptPayload(payload, process.env.TPAY_ENCRYPTION_KEY);

    console.log("🔐 Initiating payment for:", email);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/create",
      encryptedPayload,
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    console.log("✅ TransactPay response received");

    const checkoutUrl = response.data?.data?.paymentLink ||
                       response.data?.paymentLink ||
                       response.data?.data?.checkoutUrl;

    if (!checkoutUrl) {
      console.log("Full response:", response.data);
      throw new Error("No payment link returned");
    }

    // Save reference
    await Application.findOneAndUpdate(
      { email },
      { tx_ref: reference },
      { upsert: true }
    );

    res.json({
      success: true,
      checkout_url: checkoutUrl,
      reference: reference
    });

  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.log("❌ Initiate error:", errorData);
    res.status(500).json({
      success: false,
      error: errorData
    });
  }
});

// ================= VERIFY PAYMENT =================
app.post("/api/verify-payment", async (req, res) => {
  const { transaction_id, email } = req.body;
  try {
    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/status",
      { transaction_id },
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const payment = response.data?.data || response.data;
    const status = String(payment.status || "").toUpperCase();

    if (status!== "SUCCESS" && status!== "SUCCESSFUL") {
      return res.json({ success: false, status: payment.status });
    }

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid", tx_ref: payment.reference || transaction_id },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.log("❌ Verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

// ================= HEALTH CHECK =================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mongo: mongoose.connection.readyState === 1,
    has_keys:!!process.env.TPAY_PUBLIC_KEY &&!!process.env.TPAY_ENCRYPTION_KEY
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));