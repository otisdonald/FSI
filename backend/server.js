const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "index.html")));

mongoose.connect(process.env.MONGO_URI)
 .then(() => console.log("✅ MongoDB Connected"))
 .catch(err => console.log("❌ Mongo Error:", err));

const Application = mongoose.model("Application", new mongoose.Schema({
  name: String, email: String, phone: String, startup: String,
  problem: String, solution: String, business_model: String, usage: String,
  paymentStatus: { type: String, default: "unpaid" },
  tx_ref: String, createdAt: { type: Date, default: Date.now }
}));

app.post("/api/save-application", async (req, res) => {
  try {
    await Application.findOneAndDelete({ email: req.body.email });
    await Application.create(req.body);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false }); }
});

app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;
  const reference = "FSI-" + Date.now();

  await Application.findOneAndUpdate(
    { email },
    { tx_ref: reference },
    { upsert: true }
  );

  const publicKey = process.env.TPAY_PUBLIC_KEY;
  const amount = 1000;
  const redirectUrl = "https://fsi.onrender.com/pending.html";

  const checkoutUrl = `https://checkout.transactpay.ai/?publicKey=${encodeURIComponent(publicKey)}&amount=${amount}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name || '')}&phone=${encodeURIComponent(phone || '')}&reference=${reference}&currency=NGN&redirectUrl=${encodeURIComponent(redirectUrl)}`;

  res.json({
    success: true,
    checkout_url: checkoutUrl,
    reference: reference
  });
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const { reference, email } = req.body;
    const response = await axios.get(
      `https://payment-api-service.transactpay.ai/payment/orders/${reference}`,
      { headers: { "api-key": process.env.TPAY_PUBLIC_KEY } }
    );
    
    const status = response.data?.data?.status || "";
    if (status.toLowerCase().includes("success") || status.toLowerCase() === "paid") {
      await Application.findOneAndUpdate({ email }, { paymentStatus: "paid" });
      return res.json({ success: true });
    }
    res.json({ success: false, status });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));