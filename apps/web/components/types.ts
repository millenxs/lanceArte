

export type User = {
  id: string;
  name: string;
  role: 'auctioneer' | 'bidder';
};

export type ArtworkDetails = {
  id: string;
  title: string;
  artist?: string;
  artist_title?: string;
  date?: string;
  date_display?: string;
  imageUrl?: string | null;
  publicDomain?: boolean;
  source?: string;
  sourceUrl?: string;
  seedKey?: string;
};

export type LotStatus = 'live' | 'scheduled' | 'closed' | 'cancelled';

export type Lot = {
  id: string;
  title: string;
  imageUrl?: string | null;
  artwork: ArtworkDetails;
  openingBid: number;
  increment: number;
  startsAt: string;
  endsAt: string;
  status: LotStatus;
  currentBid: number | null;
  leader: string | null;
  sellerId?: string;
  sellerName: string;
  receiptToken?: string | null;
  bidCount?: number;
  auditCount?: number;
  isCurrentUserLeader?: boolean;
};

export type Bid = {
  bidder: string;
  amount: number;
  createdAt: string;
};

export type Item = {
  id: string;
  title: string;
  artist: string;
  date: string;
  imageUrl?: string | null;
  publicDomain: boolean;
  source: string;
  sourceUrl: string;
};

export type AuditEvent = {
  sequence: number;
  type: string;
  bidder?: string;
  amountCents?: number;
  winningBidCents?: number | null;
  eventHash: string;
  previousHash: string;
  createdAt: string;
};

export type AuditReport = {
  title: string;
  valid: boolean;
  events: AuditEvent[];
};

export type Receipt = {
  token: string;
  lotId: string;
  title: string;
  artwork: ArtworkDetails | null;
  imageUrl: string | null;
  amount: number;
  openingBid: number;
  winner: string;
  sellerName: string;
  bidCount: number;
  closedAt: string;
};

export type WalletWin = {
  id: string;
  title: string;
  imageUrl: string | null;
  amount: number;
  closedAt: string;
  receiptToken: string;
};

export type WalletTransaction = {
  id: string;
  lotId?: string | null;
  lotTitle?: string | null;
  kind: 'deposit' | 'reserve' | 'release' | 'settlement_debit' | 'settlement_credit';
  availableDelta: number;
  committedDelta: number;
  note: string;
  createdAt: string;
};

export type WalletData = {
  user: { id: string; name: string };
  available: number;
  committed: number;
  total: number;
  transactions?: WalletTransaction[];
};

export type Flash = {
  kind: 'success' | 'error';
  text: string;
} | null;
