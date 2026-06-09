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

  try {
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: email,
        amount: 100000, // ₦1,000 in kobo
        reference: reference,
        callback_url: "https://fsi.onrender.com/pending.html",
        metadata: {
          custom_fields: [
            { display_name: "Applicant Name", variable_name: "name", value: name },
            { display_name: "Phone", variable_name: "phone", value: phone }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    await Application.findOneAndUpdate(
      { email },
      { tx_ref: reference },
      { upsert: true }
    );

    res.json({
      success: true,
      checkout_url: response.data.data.authorization_url,
      reference: reference
    });

  } catch (err) {
    console.log("PAYSTACK ERROR:", err.response?.data);
    res.status(500).json({ success: false, error: err.response?.data?.message });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${req.body.reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    
    if (response.data.data.status === "success") {
      await Application.findOneAndUpdate(
        { email: req.body.email },
        { paymentStatus: "paid" }
      );
      return res.json({ success: true });
    }
    res.json({ success: false });
  } catch { res.status(500).json({ success: false }); }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));