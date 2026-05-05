const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();


// ================= MIDDLEWARE =================
app.use(cors());

// ⭐ VERY IMPORTANT FOR FLUTTERWAVE WEBHOOK
app.use(express.json({
  verify: (req,res,buf) => {
    req.rawBody = buf.toString();
  }
}));

app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));


// ================= BASIC ROUTES =================
app.get("/", (req,res)=>{
  res.send("FSI API is running 🚀");
});

// pending page route
app.get(["/pending","/pending.html"], (req,res)=>{
  res.sendFile(path.join(__dirname,"public","pending.html"));
});


// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));


// ================= MODELS =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name:String,
  email:String,
  phone:String,
  country:String,
  sex:String,
  dob:String,
  startup:String,
  problem:String,
  solution:String,
  business_model:String,
  usage:String,
  aiScore:Number,
  totalScore:Number,
  status:{ type:String, default:"pending" },
  paymentStatus:{ type:String, default:"unpaid" },
  tx_ref:String,
  createdAt:{ type:Date, default:Date.now }
}));

const Waitlist = mongoose.model("Waitlist", new mongoose.Schema({
  email:String,
  createdAt:{ type:Date, default:Date.now }
}));

const Admin = mongoose.model("Admin", new mongoose.Schema({
  email:String,
  password:String
}));


// ================= EMAIL =================
const transporter = nodemailer.createTransport({
  service:"gmail",
  auth:{
    user:process.env.EMAIL_USER,
    pass:process.env.EMAIL_PASS
  }
});

async function sendEmail(to,subject,text){
  await transporter.sendMail({
    from:"FSI <no-reply@fsi.com>",
    to,
    subject,
    text
  });
}


// ================= CONFIG =================
app.get("/api/config",(req,res)=>{
  res.json({ flutterwavePublicKey:process.env.FLW_PUBLIC_KEY });
});


// ================= SAVE APPLICATION BEFORE PAYMENT =================
app.post("/api/save-application", async (req,res)=>{
  try{
    const data=req.body;
    await Application.findOneAndDelete({ email:data.email });
    const appData=await Application.create(data);
    res.json({ success:true, id:appData._id });
  }catch(err){
    console.log(err);
    res.status(500).json({ success:false });
  }
});


// ================= VERIFY PAYMENT (Manual verify if needed) =================
app.post("/api/verify-payment", async (req,res)=>{
  const { transaction_id, email } = req.body;

  try{
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers:{ Authorization:`Bearer ${process.env.FLW_SECRET_KEY}` } }
    );

    const payment=response.data.data;
    if(payment.status !== "successful") return res.json({ success:false });

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus:"paid", tx_ref:payment.tx_ref }
    );

    await sendEmail(
      email,
      "Application Received 🎉",
      "Your Founders Support Initiative application has been successfully submitted."
    );

    res.json({ success:true });

  }catch(err){
    console.log(err.message);
    res.status(500).json({ success:false });
  }
});


// ================= FLUTTERWAVE WEBHOOK (AUTO CONFIRM PAYMENT) =================
app.post("/api/flutterwave-webhook", async (req,res)=>{
  try{

    // 🔐 VERIFY WEBHOOK SECRET HASH
    const secretHash = process.env.FLW_SECRET_HASH;
    const signature = req.headers["verif-hash"];

    if(!signature || signature !== secretHash){
      console.log("Invalid webhook signature");
      return res.sendStatus(401);
    }

    const payload=req.body;

    if(payload.event !== "charge.completed")
      return res.sendStatus(200);

    const payment=payload.data;
    if(payment.status !== "successful")
      return res.sendStatus(200);

    const email=payment.customer.email;

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus:"paid", tx_ref:payment.tx_ref },
      { upsert:true }
    );

    await sendEmail(
      email,
      "Application Received 🎉",
      "Your FSI application and payment have been received successfully."
    );

    console.log("Webhook payment confirmed:", email);
    res.sendStatus(200);

  }catch(err){
    console.log("Webhook error:", err.message);
    res.sendStatus(200);
  }
});


// ================= CHECK PAYMENT STATUS (Pending page uses this) =================
app.get("/api/check-status/:email", async (req,res)=>{
  try{
    const appData = await Application.findOne({ email:req.params.email });
    if(!appData) return res.json({ status:"not_found" });
    res.json({ status:appData.paymentStatus });
  }catch(err){
    res.json({ status:"error" });
  }
});


// ================= ADMIN =================
function auth(req,res,next){
  const token=req.headers.authorization;
  if(!token) return res.status(401).send("Unauthorized");
  try{
    jwt.verify(token,process.env.JWT_SECRET);
    next();
  }catch{
    res.status(401).send("Invalid token");
  }
}

app.post("/api/admin/login", async (req,res)=>{
  const { email,password }=req.body;
  const admin=await Admin.findOne({ email });
  if(!admin) return res.json({ success:false });

  const match=await bcrypt.compare(password,admin.password);
  if(!match) return res.json({ success:false });

  const token=jwt.sign({ id:admin._id },process.env.JWT_SECRET);
  res.json({ success:true, token });
});

app.get("/api/all-applications", auth, async (req,res)=>{
  const apps=await Application.find().sort({ createdAt:-1 });
  res.json(apps);
});

app.get("/api/analytics", auth, async (req,res)=>{
  const total=await Application.countDocuments();
  const paid=await Application.countDocuments({ paymentStatus:"paid" });
  res.json({ total, paid });
});


// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port",PORT));