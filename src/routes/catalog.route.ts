import { Router } from "express";
import { getCatalog, getCategories } from "../services/catalog.service.js";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json(getCatalog());
});

router.get("/categories", (_req, res) => {
  res.status(200).json(getCategories());
});

export default router;
