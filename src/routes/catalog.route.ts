import { Router } from "express";
import catalogService from "../services/catalog.service";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json(catalogService.getCatalog());
});

router.get("/categories", (_req, res) => {
  res.status(200).json(catalogService.getCategories());
});

export default router;
