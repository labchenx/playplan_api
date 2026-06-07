const express = require("express");
const { checkDatabase } = require("../db/mysql");
const { checkStorage } = require("../storage/cos");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    code: 0,
    data: {
      status: "ok",
      service: "playplan_api",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || "development",
    },
  });
});

router.get("/db-check", async (req, res, next) => {
  try {
    const result = await checkDatabase();

    if (!result.ok) {
      res.status(503).json({
        code: 1001,
        message:
          result.status === "missing_config"
            ? "MySQL config incomplete"
            : "MySQL connection check failed",
        data: result,
      });
      return;
    }

    res.json({
      code: 0,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/storage-check", async (req, res, next) => {
  try {
    const result = await checkStorage();

    if (!result.ok) {
      res.status(503).json({
        code: 1002,
        message:
          result.status === "missing_config"
            ? "Storage config incomplete"
            : "Storage connection check failed",
        data: result,
      });
      return;
    }

    res.json({
      code: 0,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// WeChat CloudBase injects the OpenID headers in the container runtime.
router.get("/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
    return;
  }

  res.status(404).json({
    code: 404,
    message: "OpenID is only available in WeChat CloudBase context",
  });
});

module.exports = router;
