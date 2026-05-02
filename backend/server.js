const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

// ================= MODELS =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  sex: String,
  dob: String,
  startup: String,
  problem: String,
  solution: String,
  business_model: String,
  usage: String,
  aiScore: Number,
  totalScore: Number,
  status: { type:String, default:"pending" },
  paymentStatus: { type:String, default:"unpaid" },
  tx_ref: String,
  createdAt: { type:Date, default:Date.now }
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

// ================= AUTH =================
function auth(req,res,next){
  const token = req.headers.authorization;
  if(!token) return res.status(401).send("Unauthorized");

  try{
    jwt.verify(token,process.env.JWT_SECRET);
    next();
  }catch{
    res.status(401).send("Invalid token");
  }
}

// ================= SEND FLUTTERWAVE PUBLIC KEY =================
app.get("/api/config",(req,res)=>{
  res.json({ flutterwavePublicKey:process.env.FLW_PUBLIC_KEY });
});

// ================= ROUTES =================
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"public/index.html")));
app.get("/apply",(req,res)=>res.sendFile(path.join(__dirname,"public/apply.html")));
app.get("/success",(req,res)=>res.sendFile(path.join(__dirname,"public/success.html")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public/admin.html")));
app.get("/admin-login",(req,res)=>res.sendFile(path.join(__dirname,"public/admin-login.html")));

// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req,res)=>{
  try{
    const data = req.body;

    const exists = await Application.findOne({ email:data.email });
    if(exists) return res.json({ success:false, message:"Duplicate application" });

    const appData = await Application.create(data);
    res.json({ success:true, id:appData._id });

  }catch(err){
    console.log(err);
    res.status(500).json({ success:false });
  }
});

// ================= VERIFY PAYMENT =================
const axios = require("axios");

app.post("/api/verify-payment", async (req,res)=>{
  const { transaction_id, email } = req.body;

  try{
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers:{
          Authorization:`Bearer ${process.env.FLW_SECRET_KEY}`
        }
      }
    );

    const payment = response.data.data;

    if(payment.status !== "successful"){
      return res.json({ success:false });
    }

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus:"paid", tx_ref:payment.tx_ref }
    );

    await sendEmail(
      email,
      "Application Received",
      "Your application has been successfully submitted."
    );

    res.json({ success:true });

  }catch(err){
    console.log(err.message);
    res.status(500).json({ success:false });
  }
});

// ================= ADMIN LOGIN =================
app.post("/api/admin/login", async (req,res)=>{
  const { email,password } = req.body;

  const admin = await Admin.findOne({ email });
  if(!admin) return res.json({ success:false });

  const match = await bcrypt.compare(password, admin.password);
  if(!match) return res.json({ success:false });

  const token = jwt.sign({ id:admin._id },process.env.JWT_SECRET);
  res.json({ success:true, token });
});

// ================= ANALYTICS =================
app.get("/api/all-applications", auth, async (req,res)=>{
  const apps = await Application.find().sort({ createdAt:-1 });
  res.json(apps);
});

app.get("/api/analytics", auth, async (req,res)=>{
  const total = await Application.countDocuments();
  const paid = await Application.countDocuments({ paymentStatus:"paid" });
  res.json({ total, paid });
});

app.listen(3000,()=>console.log("Server running on port 3000"));