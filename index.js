const express = require('express');
const dotenv = require('dotenv').config();
const app = express();
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

app.listen(3000, () => {
  console.log("connection to server successful")
});

app.use(express.json());
app.use(express.urlencoded({extended: false}));

(async () => {
  try {
    const db = await mongoose.connect("mongodb://localhost:27017");
    console.log("connected to database");
  }
  catch (e) {
    console.log(e);
    process.exit(1);
  }
})()


const unpaidTransactionSchema = mongoose.Schema(
  {
    lender: {
      type: String,
      required: true
    },
    borrower: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    repaid: {
      type: Boolean,
      default: false
    }
  }, {
    timestamps: true
  }
)

const paidTransactionSchema = mongoose.Schema ({
  _id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  lender: {
    type: String,
    reqiured: true
  }, 
  borrower: {
    type: String,
    required: true
  }, 
  repaid: {
    type: Boolean,
    default: true
  },
  repayingDate: {
    type: Date,
    default: Date.now
  }
})

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    },
    totalBorrowed: {
      type: Number,
      default: 0
    },
    totalLent: {
      type: Number,
      default: 0
    },
    password: {
      type: String,
      required: true
    }
  }
)

const unpaidTransactions = mongoose.model('unpaidransactions', unpaidTransactionSchema);
const user = mongoose.model('user', userSchema);
const paidTransactions = mongoose.model('paidTransactions', paidTransactionSchema);

const generateToken = (id) => {
  return jwt.sign({id}, process.env.JWT_SECRET, {
    expiresIn: '30d'
  })
}

app.get("/", (req, res) => {
  res.send("Welcome to your own book-keeper")
})

app.post('/signup', asyncHandler(async (req, res) => {
  const {name, email, phone, password} = req.body;

  if (!name || !email || !phone || !password) {
    res.status(400);
    throw new Error('enter all credentials');
  }

  const if_exists = await user.find({email});

  if (if_exists.length > 0) {
    throw new Error('user already exists. Please try with different email');
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const newUser = await user.create({
    name,email,phone,
    password: hashedPassword
  })

  if (!newUser) {
    throw new Error('user creation error')
  }

  res.status(201);
  res.json({
    name,email,phone, 
    token: generateToken(newUser.id)
  })
}))

app.post('/login', asyncHandler(async (req, res) => {
  const {email, password} = req.body;
  const queriedUser = await user.findOne({email});

  if (!queriedUser) {
    res.status(400)
    throw new Error('User not found')
  }

  if (await bcrypt.compare(password, queriedUser.password)) {
    res.json({
      _id: queriedUser.id,
      name: queriedUser.name,
      email: queriedUser.email,
      token: generateToken(queriedUser.id)
    })
  }
  else {
    res.status(400);
    throw new Error('wrong password')
  }
}))

const authenticator = asyncHandler(async (req, res, next) => {
  const token = req.header('auth-token')

  if (!token) {
    res.status(400)
    throw new Error('please provide authentication token')
  }

  const data = jwt.verify(token, process.env.JWT_SECRET);
  if(!data || !data.id) {
    res.status(400)
    throw new Error('invlaid token')
  }

  req.userId = data.id;
  next();
})

app.post("/newtransaction", authenticator, asyncHandler( async (req, res) => {
  const lenderValid = await user.findOne({email: req.body.lender});
  if (!lenderValid) {
    res.status(400).json({message: 'enter valid sender email address'})
  }
  
  const borrowerValid = await user.findOne({email: req.body.borrower});
  if(!borrowerValid) {
    res.status(400).json({message:'enter valid recepient email address'})
  }

  const lenderUpdate = await user.findOneAndUpdate({email: lenderValid.email}, {totalLent: lenderValid.totalLent + req.body.amount}, {
    returnOriginal: false
  })
  
  const borrowerUpdate = await user.findOneAndUpdate({email: borrowerValid.email}, {totalBorrowed: borrowerValid.totalBorrowed + req.body.amount}, {
    returnOriginal: false
  })

  if (!lenderUpdate && !borrowerUpdate) {
    res.status(500);
    throw new Error('internal server error');
  }

  const transaction = await unpaidTransactions.create(
    {
      lender: req.body.lender,
      borrower: req.body.borrower,
      amount: req.body.amount
    }
  )

  if (!transaction) {
    res.status(500).send('internal server error');
  }

  res.status(201).json(transaction);
  
}))

app.get("/myunpaidtransactions", authenticator, asyncHandler( async (req,res) => {
  const queriedUser = await user.findOne({_id: req.userId})
  const allBorrowed = await unpaidTransactions.find({ $or: [ {borrower: queriedUser.email}, {lender: queriedUser.email}]});

  res.status(200).send(allBorrowed)
}))

app.get("/mypaidtransactions", authenticator, asyncHandler( async (req, res) => {
  const queriedUser = await user.findOne({_id: req.userId})
  const allBorrowed = await paidTransactions.find({ $or: [ {borrower: queriedUser.email}, {lender: queriedUser.email}]});

  res.status(200).send(allBorrowed)
}))

app.put("/repay", authenticator, asyncHandler( async(req,res) => {
  const User = await user.findOne({_id: req.userId});

  if(!User) {
    res.status(404)
    throw new Error('user not found')
  }

  const txn = await unpaidTransactions.findByIdAndDelete(req.body.id);

  if (!txn) {
    res.status(404);
    throw new Error('transaction id not found')
  }

  const lenderUpdate = await user.findOneAndUpdate({email: txn.lender}, {$inc: {totalLent: -1 * txn.amount}}, {
    returnOriginal: false
  })
  
  const borrowerUpdate = await user.findOneAndUpdate({email: txn.borrower}, {$inc: {totalBorrowed: -1 * txn.amount}}, {
    returnOriginal: false
  })  

  if (!lenderUpdate && !borrowerUpdate) {
    res.status(500);
    throw new Error('internal server error');
  }

  const paidTxn = await paidTransactions.create({
    _id : txn._id,
    lender: txn.lender,
    borrower: txn.borrower,
  })

  if (!paidTxn) {
    res.status(500);
    throw new Error('internal sever error')
  }

  res.status(200).json(paidTxn)
}))
