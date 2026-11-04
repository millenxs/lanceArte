export const PUBLIC_LOT_SELECT = `
  SELECT lots.*, users.name AS seller_name, receipts.token AS receipt_token,
    (SELECT count(*)::int FROM bids WHERE bids.lot_id=lots.id) AS bid_count
  FROM lots
  JOIN users ON users.id=lots.seller_id
  LEFT JOIN receipts ON receipts.lot_id=lots.id
`;
