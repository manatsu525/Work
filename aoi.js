import { service } from "./index.js";

export const fetchOptions = async (startTime, endTime) =>
  service
    .get("/api/v1/aoi/options", { params: { startTime, endTime } })
    .then((resData) => {
      resData.forEach((item) => {
        item.wafer = `${item.lot}#${item.wafer}`;
      });

      return resData;
    });

export const fetchWaferAoiList = async (
  startTime,
  endTime,
  product,
  layer,
  eqp,
  lot,
  wafer
) =>
  service
    .get("/api/v1/aoi/summary", {
      params: { startTime, endTime, product, layer, eqp, lot, wafer },
    })
    .then((resData) => {
      resData.forEach((item) => {
        item.wafer = `${item.lot}#${item.wafer}`;
        item.bubbleSize = parseFloat(item.bubbleSize);
        item.bondDieCount = item.bondDieCount
          ? parseFloat(item.bondDieCount)
          : "";
      });

      return resData;
    });

export const fetchDefectRawData = async (waferKey) =>
  service
    .get("/api/v1/aoi/rawdata", {
      params: { waferKey },
    })
    .then((resData) => {
      return resData;
    });

export const fetchDefectDetail = async (wafer_key, defect_id) =>
  service
    .get("/api/v1/aoi/defect_detail", { params: { wafer_key, defect_id } })
    .then((resData) => {
      return resData;
    });

export const fetchDefectImage = async (wafer_key, defect_id) =>
  service
    .get("/api/v1/aoi/defects/image", {
      params: {
        wafer_key,
        defect_id,
      },
      responseType: "blob",
    })
    .then((resData) => {
      return resData;
    });
