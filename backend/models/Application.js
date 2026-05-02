const mongoose = require("mongoose");

const ApplicationSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  startup: String,
  industry: String,
  description: String,
  amount: Number,
  usage: String,
  paymentStatus: String,
  tx_ref: String
}, { timestamps: true });

module.exports = mongoose.model("Application", ApplicationSchema);