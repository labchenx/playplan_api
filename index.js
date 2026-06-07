const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const apiRoutes = require("./src/routes");

const logger = morgan("tiny");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use("/api", apiRoutes);

app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: "Not Found",
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    code: 500,
    message: "Internal Server Error",
  });
});

const port = process.env.PORT || 80;

function bootstrap() {
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
