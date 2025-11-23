import express from "express";
import path from "path";
import dotenv from "dotenv";
import registerRouter from "./routes/register.js";
import loginRouter from "./routes/login.js";   // ← DODANE
import { fileURLToPath } from "url";
import friendsRouter from './routes/friends.js';
import messagesRouter from './routes/messages.js';
import usersRouter from './routes/users.js';


// ES Modules paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// JSON parser
app.use(express.json({ limit: "1mb" }));

// CORS (tymczasowo)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// API routes
app.use("/api/register", registerRouter);
app.use("/api/login", loginRouter);   
app.use('/api/friends', friendsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/users', usersRouter);

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

export default app;
