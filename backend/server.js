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

// ================= ENCRYPTION (FINAL FIX FOR TRANSACTPAY) =================
function encryptPayload(payload, encryptionKey) {
  try {
    // TransactPay gives you a base64-encoded key - decode it first
    const decodedKey = Buffer.from(encryptionKey, 'base64');

    // Use first 32 bytes for AES-256 (if longer, slice; if shorter, hash)
    const key = decodedKey.length >= 32
     ? decodedKey.slice(0, 32)
      : crypto.createHash('sha256').update(decodedKey).digest();

    console.log("🔑 Using key length:", key.length, "bytes");

    // TransactPay uses AES-256-ECB
    const cipher = crypto.createCipheriv("aes-256-ecb", key, null);
    cipher.setAutoPadding(true);

    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return { data: encrypted };
  } catch (err) {
    console.log("❌ Encryption error:", err.message);
    throw err;
  }
}

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

// ================= INITIATE PAYMENT =================
app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;

  try {
    if (!process.env.TPAY_PUBLIC_KEY ||!process.env.TPAY_ENCRYPTION_KEY) {
      throw new Error("Missing keys");
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

    const checkoutUrl = response.data?.data?.paymentLink || response.data?.paymentLink;

    if (!checkoutUrl) {
      console.log("Response:", response.data);
      throw new Error("No payment link");
    }

    console.log("✅ Checkout URL received");

    await Application.findOneAndUpdate(
      { email },
      { tx_ref: reference },
      { upsert: true }
    );

    res.json({ success: true, checkout_url: checkoutUrl, reference });

  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.log("❌ Initiate error:", errorData);
    res.status(500).json({ success: false, error: errorData });
  }
});

// ================= VERIFY PAYMENT =================
app.post("/api/verify-payment", async (req, res) => {
  const { transaction_id, email } = req.body;
  try {
    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/status",
      { transaction_id },
      { headers: { "api-key": process.env.TPAY_PUBLIC_KEY, "Content-Type": "application/json" } }
    );

    const payment = response.data?.data || response.data;
    const status = String(payment.status || "").toUpperCase();

    if (status!== "SUCCESS" && status!== "SUCCESSFUL") {
      return res.json({ success: false, status });
    }

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid" },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.log("❌ Verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

// ================= HEALTH =================
app.get("/health", (req, res) => {
  res.json({ status: "ok", mongo: mongoose.connection.readyState === 1 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));