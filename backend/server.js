// ================= IMPORTS =================
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json({
  verify: (req,res,buf)=>{ req.rawBody = buf.toString(); }
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public")));

// ================= BASIC ROUTES =================
app.get("/", (req,res)=> res.send("FSI API running 🚀"));

app.get(["/pending","/pending.html"], (req,res)=>{
  res.sendFile(path.join(__dirname,"public","pending.html"));
});

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

// ================= MODEL =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name:String,
  email:String,
  phone:String,
  sex:String,
  dob:String,
  startup:String,
  problem:String,
  solution:String,
  business_model:String,
  usage:String,
  paymentStatus:{ type:String, default:"unpaid" },
  tx_ref:String,
  createdAt:{ type:Date, default:Date.now }
}));

/// ================= EMAIL (ZOHO SMTP) =================
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true, // SSL
  auth: {
    user: process.env.EMAIL_USER, // contact@founderssupport.org
    pass: process.env.EMAIL_PASS  // Zoho mailbox password
  }
});

async function sendEmail(to, subject, message){
  try{
    await transporter.sendMail({
      from: `"Founders Support Initiative" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: `
        <div style="font-family:Arial;max-width:600px;margin:auto">
          <h2 style="color:#1e40af">Application Successful 🎉</h2>

          <p>${message}</p>

          <p>
            Our team will review your application and contact you soon.
          </p>

          <br>
          <p>
            Warm regards,<br>
            <b>Founders Support Initiative</b><br>
            https://founderssupport.org
          </p>
        </div>
      `
    });

    console.log("📧 Email sent to", to);
  }catch(err){
    console.log("❌ Email error:", err.message);
  }
}

// ================= CONFIG =================
app.get("/api/config",(req,res)=>{
  res.json({ flutterwavePublicKey:process.env.FLW_PUBLIC_KEY });
});

// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req,res)=>{
  try{
    const data=req.body;
    await Application.findOneAndDelete({ email:data.email });
    const appData=await Application.create(data);
    res.json({ success:true, id:appData._id });
  }catch(err){
    res.status(500).json({ success:false });
  }
});

// ================= VERIFY PAYMENT (FALLBACK) =================
app.post("/api/verify-payment", async (req,res)=>{
  const { transaction_id,email }=req.body;

  try{
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers:{ Authorization:`Bearer ${process.env.FLW_SECRET_KEY}` } }
    );

    const payment=response.data.data;
    if(payment.status!=="successful") return res.json({ success:false });

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus:"paid", tx_ref:payment.tx_ref },
      { upsert:true }
    );

    await sendEmail(email,"Application Received 🎉",
      "Your FSI application has been submitted successfully.");

    res.json({ success:true });

  }catch(err){
    console.log(err.message);
    res.status(500).json({ success:false });
  }
});

// ================= CHECK STATUS (PENDING PAGE) =================
app.get("/api/check-status/:email", async (req,res)=>{
  const appData = await Application.findOne({ email:req.params.email });
  if(!appData) return res.json({ status:"not_found" });
  res.json({ status:appData.paymentStatus });
});

// =======================================================
// 🔥🔥 FINAL FLUTTERWAVE WEBHOOK 🔥🔥
// =======================================================
app.post("/api/flutterwave-webhook", (req, res) => {
  console.log("🔔 Webhook received");

  // Flutterwave requires instant 200 response
  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const signature = req.headers["verif-hash"];

      // 🔐 Verify webhook signature
      if (!signature) {
        console.log("❌ No signature header");
        return;
      }

      if (signature !== process.env.FLW_SECRET_HASH) {
        console.log("❌ Invalid webhook signature");
        return;
      }

      console.log("✅ Webhook verified");

      const payment = req.body.data;

      // ⭐ Only trust successful payments
      if (!payment || payment.status !== "successful") {
        console.log("Payment not successful yet");
        return;
      }

      const email = payment.customer?.email;
      const tx_ref = payment.tx_ref;

      console.log("💰 PAYMENT DATA:", email, tx_ref);

      // ✅ Update application as PAID
      await Application.findOneAndUpdate(
        { email },
        { paymentStatus: "paid", tx_ref },
        { upsert: true }
      );

      // ✉️ PROFESSIONAL EMAIL MESSAGE
      const message = `
        Your application and payment have been successfully received.

        Thank you for applying to the Founders Support Initiative (FSI).

        Our review team will carefully evaluate your submission and you will
        be contacted via email with the next steps.

        If you have any questions, feel free to reply to this email.

        — Founders Support Initiative
        https://founderssupport.org
      `;

      // 📧 Send confirmation email
      await sendEmail(
        email,
        "Application Received — Founders Support Initiative",
        message
      );

      console.log("🎉 PAYMENT SAVED TO DB + EMAIL SENT");

    } catch (err) {
      console.log("Webhook error:", err.message);
    }
  });
});

app.get("/ip", async (req,res)=>{
  const axios = require("axios");
  const ip = await axios.get("https://api.ipify.org");
  res.send(ip.data);
});
// ================= START SERVER =================
const PORT=process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port",PORT));