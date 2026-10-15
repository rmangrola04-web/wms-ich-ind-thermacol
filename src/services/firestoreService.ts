import {
  db,
  auth,
  collection,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  query,
  where,
  writeBatch
} from '../firebase';
import { getDoc, getDocFromServer } from 'firebase/firestore';
import {
  UserAccount,
  PlanEntry,
  LoadUnloadEntry,
  SecurityGateEntry,
  TrackingRecord
} from '../types';
import {
  ThermocolInward,
  ThermocolInvoice,
  ThermocolProduct,
  ThermocolParty,
  ThermocolTransporter,
  ClientDemand,
  InvoiceAuditLog
} from '../views/thermocol/types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.warn('Firestore Error Info: ', JSON.stringify(errInfo));
}

// Connection test on boot
export async function testFirestoreConnection() {
  try {
    console.log('[Firestore] Testing connection to Firestore database...');
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('[Firestore] Connection test successful. Database is online and synchronized.');
  } catch (error) {
    console.log('[Firestore] Connection test reachability checked.');
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("[Firestore Warning] Please check your Firebase configuration: client is offline.");
    }
  }
}
testFirestoreConnection();

// Collection Names in Firestore
export const COLLECTIONS = {
  OPERATIONS: 'ich_operations',
  SECURITY_LOGS: 'ich_security_logs',
  PLAN_ENTRIES: 'ich_plan_entries',
  TRACKING_RECORDS: 'ich_tracking_records',
  USERS: 'ich_users',
  MASTER_TRANSPORTERS: 'ich_master_transporters',
  MASTER_VEHICLE_TYPES: 'ich_master_vehicle_types',
  MASTER_LOAD_LOCATIONS: 'ich_master_load_locations',
  MASTER_UNLOAD_LOCATIONS: 'ich_master_unload_locations',
  MASTER_SUPERVISORS: 'ich_master_supervisors',
  ARCHIVED_PLAN_ENTRIES: 'ich_archived_plan_entries',
  PACKING_INWARDS: 'packing_inwards',
  PACKING_OUTWARDS: 'packing_outwards',
  PACKING_CUSTOMERS: 'packing_customers',
  PACKING_TRANSPORTERS: 'packing_transporters',
  PACKING_MASTER: 'packing_master',
  TH_INWARDS: 'ich_th_inwards',
  TH_INVOICES: 'ich_th_invoices',
  TH_PRODUCTS: 'ich_th_products',
  TH_PARTIES: 'ich_th_parties',
  TH_TRANSPORTERS: 'ich_th_transporters',
  TH_DEMANDS: 'ich_th_demands',
  TH_AUDITS: 'ich_th_audits',
  TH_SEQUENCES: 'ich_th_sequences',
  THERMOCOL_PACKING: 'thermocol_packing'
};

// ==========================================
// REAL-TIME LISTENERS (onSnapshot)
// ==========================================

// Helper function to normalize any raw date string/number/timestamp into YYYY-MM-DD local format
function normalizeDateToYmd(val: any): string {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return '';
  }
  const str = String(val).trim();
  if (!str) return '';

  // 1. YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }

  // 2. DD/MM/YYYY
  const slash = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) {
    const p1 = parseInt(slash[1], 10);
    const p2 = parseInt(slash[2], 10);
    const year = slash[3];
    let month: number;
    let day: number;
    if (p1 > 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12) {
      month = p1;
      day = p2;
    } else {
      // Indian DD/MM/YYYY default
      day = p1;
      month = p2;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  return '';
}

export const subscribeToOperations = (
  callback: (data: LoadUnloadEntry[]) => void,
  onError?: (err: any) => void
) => {
  console.log(`[Firestore Sub] Connecting to collection: ${COLLECTIONS.OPERATIONS}`);
  const colRef = collection(db, COLLECTIONS.OPERATIONS);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: LoadUnloadEntry[] = [];
      snapshot.forEach((docSnap) => {
        const item = docSnap.data() as any;
        if (!item) return;
        const isInvoice = item.type === 'INVOICE' || (item.invNo && item.grandTotal !== undefined && item.partyName);
        if (isInvoice) return;
        if (item.operationType || item.gateId || item.bayNo || item.driverName || (item.vehicleNo && !item.invNo && item.type !== 'INVOICE')) {
          list.push({ ...item, id: docSnap.id });
        }
      });
      console.log(`[Firestore Sync] ${COLLECTIONS.OPERATIONS} snapshot received: ${list.length} docs (fromCache: ${snapshot.metadata.fromCache})`);
      callback(list);
    },
    (err) => {
      console.error(`[Firestore Error] ${COLLECTIONS.OPERATIONS} sync error:`, err?.code, err?.message);
      if (err?.code === 'unavailable') {
        console.warn('Firestore Operations offline; serving from local cache.');
      } else {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.OPERATIONS);
      }
      if (onError) onError(err);
    }
  );
};

export const subscribeToAllIchOperations = (
  onData: (data: {
    inwards?: ThermocolInward[];
    invoices?: ThermocolInvoice[];
    audits?: InvoiceAuditLog[];
    products?: ThermocolProduct[];
    parties?: ThermocolParty[];
    transporters?: ThermocolTransporter[];
    demands?: ClientDemand[];
    operations?: LoadUnloadEntry[];
  }) => void
) => {
  console.log(`[Firestore Sub] Subscribing to ALL documents in ${COLLECTIONS.OPERATIONS}...`);
  const colRef = collection(db, COLLECTIONS.OPERATIONS);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const inwardsMap = new Map<string, ThermocolInward>();
      const invoicesMap = new Map<string, ThermocolInvoice>();
      const auditsMap = new Map<string, InvoiceAuditLog>();
      const productsMap = new Map<string, ThermocolProduct>();
      const partiesMap = new Map<string, ThermocolParty>();
      const transportersMap = new Map<string, ThermocolTransporter>();
      const demandsMap = new Map<string, ClientDemand>();
      const operationsList: LoadUnloadEntry[] = [];

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const id = docSnap.id;
        if (!d) return;

        const isInvoice = (d.type === 'INVOICE' || (d.invNo && d.grandTotal !== undefined && d.partyName)) && d.type !== 'INWARD' && d.invNo !== 'Opening stock';
        if (isInvoice) {
          let invNo = d.invNo || id;
          if (!invNo.includes('/') && invNo.includes('_26')) {
            invNo = invNo.replace(/_26$/, '/26');
          }
          invoicesMap.set(invNo, { ...d as ThermocolInvoice, invNo });
          return;
        }

        if (d.type === 'INWARD' || d.grNo || (d.initialQty !== undefined && d.availableQty !== undefined)) {
          const inwId = d.id || id;
          inwardsMap.set(inwId, { ...d as ThermocolInward, id: inwId });
        } else if (d.type === 'AUDIT' || (d.action && d.complianceChecksum)) {
          const audId = d.id || id;
          auditsMap.set(audId, { ...d as InvoiceAuditLog, id: audId });
        } else if (d.type === 'PRODUCT' || (d.name && d.packSize)) {
          const prodKey = `${d.company || 'AIL'}_${String(d.name).trim().toLowerCase()}`;
          productsMap.set(prodKey, { ...d as ThermocolProduct, id: d.id || id });
        } else if (d.type === 'PARTY' || (d.name && d.gstin !== undefined)) {
          const partyKey = `${d.company || 'AIL'}_${String(d.name).trim().toLowerCase()}`;
          partiesMap.set(partyKey, { ...d as ThermocolParty, id: d.id || id });
        } else if (d.type === 'TRANSPORTER' || (d.name && d.transporterCode)) {
          const transKey = `${d.company || 'AIL'}_${String(d.name).trim().toLowerCase()}`;
          transportersMap.set(transKey, { ...d as ThermocolTransporter, id: d.id || id });
        } else if (d.type === 'DEMAND' || (d.partyName && d.monthlyLimit !== undefined)) {
          const demKey = `${d.company || 'AIL'}_${String(d.partyName).trim().toLowerCase()}_${String(d.productName || '').trim().toLowerCase()}`;
          demandsMap.set(demKey, { ...d as ClientDemand, id: d.id || id });
        } else if (d.operationType || d.gateId || d.bayNo || d.driverName) {
          operationsList.push({ ...d as LoadUnloadEntry, id });
        }
      });

      console.log(`[Firestore Sync] ich_operations full snapshot fetched: ${snapshot.size} total docs`);

      onData({
        inwards: Array.from(inwardsMap.values()),
        invoices: Array.from(invoicesMap.values()),
        audits: Array.from(auditsMap.values()),
        products: Array.from(productsMap.values()),
        parties: Array.from(partiesMap.values()),
        transporters: Array.from(transportersMap.values()),
        demands: Array.from(demandsMap.values()),
        operations: operationsList
      });
    },
    (err) => {
      console.warn(`[Firestore Error] ich_operations full sync warning:`, err?.code, err?.message);
    }
  );
};

// ==========================================
// DEEP SANITIZER FOR FIRESTORE (Removes all undefined fields recursively)
// ==========================================
export const deepSanitizeForFirestore = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => deepSanitizeForFirestore(item));
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      clean[key] = deepSanitizeForFirestore(value);
    }
  }
  return clean;
};

// ==========================================
// DIRECT FIRESTORE QUERY FOR INVOICES ('ich_operations')
// ==========================================
export const fetchInvoicesFromIchOperations = async (): Promise<ThermocolInvoice[]> => {
  try {
    console.log(`[Firestore Direct] Querying all invoices from collection: ${COLLECTIONS.OPERATIONS}`);
    const colRef = collection(db, COLLECTIONS.OPERATIONS);
    const snapshot = await getDocs(colRef);
    const invoicesMap = new Map<string, ThermocolInvoice>();

    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      const id = docSnap.id;
      if (!d) return;

      const isInvoice = (d.type === 'INVOICE' || (d.invNo && d.grandTotal !== undefined && d.partyName)) && d.type !== 'INWARD' && d.invNo !== 'Opening stock';
      if (isInvoice) {
        let invNo = d.invNo || id;
        if (!invNo.includes('/') && invNo.includes('_26')) {
          invNo = invNo.replace(/_26$/, '/26');
        }
        const company = d.company || (invNo.startsWith('AHPL') ? 'HPL' : 'AIL');
        invoicesMap.set(invNo, {
          ...d as any,
          invNo,
          company,
          items: Array.isArray(d.items) ? d.items : [],
          totalTaxable: String(d.totalTaxable || '0'),
          totalGst: String(d.totalGst || '0'),
          grandTotal: String(d.grandTotal || '0'),
          totalQty: Number(d.totalQty) || 0,
          totalCases: Number(d.totalCases) || 0,
          date: d.date || (d.createdAt ? d.createdAt.split('T')[0] : new Date().toISOString().split('T')[0])
        });
      }
    });

    // Secondary fallback to packing_outwards if ich_operations yielded 0 invoices
    if (invoicesMap.size === 0) {
      try {
        const snapOut = await getDocs(collection(db, COLLECTIONS.PACKING_OUTWARDS));
        snapOut.forEach((docSnap) => {
          const d = docSnap.data();
          if (d && (d.invNo || d.items)) {
            let invNo = d.invNo || docSnap.id;
            invoicesMap.set(invNo, { ...d as any, invNo, items: Array.isArray(d.items) ? d.items : [] });
          }
        });
      } catch (e) {
        // non-blocking
      }
    }

    const result = Array.from(invoicesMap.values()).sort((a, b) => {
      const timeA = new Date(a.date || a.createdAt || 0).getTime();
      const timeB = new Date(b.date || b.createdAt || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return b.invNo.localeCompare(a.invNo);
    });

    console.log(`[Firestore Direct] Successfully retrieved ${result.length} invoices from ich_operations`);
    return result;
  } catch (err) {
    console.error('[Firestore Direct] Error fetching invoices from ich_operations:', err);
    return [];
  }
};

// ==========================================
// EXPLICIT getDocs DATA LOADER FOR ich_operations (APP STARTUP & REFRESH)
// ==========================================
export const fetchIchOperationsWithGetDocs = async (): Promise<{
  operations: LoadUnloadEntry[];
  inwards: ThermocolInward[];
  invoices: ThermocolInvoice[];
  audits: InvoiceAuditLog[];
  products: ThermocolProduct[];
  parties: ThermocolParty[];
  transporters: ThermocolTransporter[];
  demands: ClientDemand[];
}> => {
  console.log(`[Firestore getDocs] Explicitly fetching all documents from collection: ${COLLECTIONS.OPERATIONS}`);
  const colRef = collection(db, COLLECTIONS.OPERATIONS);
  const snapshot = await getDocs(colRef);
  console.log(`[Firestore getDocs] Retrieved ${snapshot.size} documents from ${COLLECTIONS.OPERATIONS}`);

  const inwardsMap = new Map<string, ThermocolInward>();
  const invoicesMap = new Map<string, ThermocolInvoice>();
  const auditsMap = new Map<string, InvoiceAuditLog>();
  const productsMap = new Map<string, ThermocolProduct>();
  const partiesMap = new Map<string, ThermocolParty>();
  const transportersMap = new Map<string, ThermocolTransporter>();
  const demandsMap = new Map<string, ClientDemand>();
  const operationsList: LoadUnloadEntry[] = [];

  snapshot.forEach((docSnap) => {
    const d = docSnap.data();
    const id = docSnap.id;
    if (!d) return;

    const isInvoice = (d.type === 'INVOICE' || (d.invNo && d.grandTotal !== undefined && d.partyName)) && d.type !== 'INWARD' && d.invNo !== 'Opening stock';
    if (isInvoice) {
      let invNo = d.invNo || id;
      if (!invNo.includes('/') && invNo.includes('_26')) {
        invNo = invNo.replace(/_26$/, '/26');
      }
      const company = d.company || (invNo.startsWith('AHPL') ? 'HPL' : 'AIL');
      invoicesMap.set(invNo, {
        ...d as any,
        invNo,
        company,
        items: Array.isArray(d.items) ? d.items : [],
        totalTaxable: String(d.totalTaxable || '0'),
        totalGst: String(d.totalGst || '0'),
        grandTotal: String(d.grandTotal || '0'),
        totalQty: Number(d.totalQty) || 0,
        totalCases: Number(d.totalCases) || 0,
        date: d.date || (d.createdAt ? d.createdAt.split('T')[0] : new Date().toISOString().split('T')[0])
      });
      return;
    }

    if (d.type === 'INWARD' || d.grNo || (d.initialQty !== undefined && d.availableQty !== undefined)) {
      const inwId = d.id || id;
      inwardsMap.set(inwId, { ...d as ThermocolInward, id: inwId });
    } else if (d.type === 'AUDIT' || (d.action && d.complianceChecksum)) {
      const audId = d.id || id;
      auditsMap.set(audId, { ...d as InvoiceAuditLog, id: audId });
    } else if (d.type === 'PRODUCT' || (d.name && d.packSize)) {
      const prodKey = `${d.company || 'AIL'}_${String(d.name).trim().toLowerCase()}`;
      productsMap.set(prodKey, { ...d as ThermocolProduct, id: d.id || id });
    } else if (d.type === 'PARTY' || (d.name && d.gstin !== undefined)) {
      const partyKey = `${d.company || 'AIL'}_${String(d.name).trim().toLowerCase()}`;
      partiesMap.set(partyKey, { ...d as ThermocolParty, id: d.id || id });
    } else if (d.type === 'TRANSPORTER' || (d.name && d.transporterCode)) {
      const transKey = `${d.company || 'AIL'}_${String(d.name).trim().toLowerCase()}`;
      transportersMap.set(transKey, { ...d as ThermocolTransporter, id: d.id || id });
    } else if (d.type === 'DEMAND' || (d.partyName && d.monthlyLimit !== undefined)) {
      const demKey = `${d.company || 'AIL'}_${String(d.partyName).trim().toLowerCase()}_${String(d.productName || '').trim().toLowerCase()}`;
      demandsMap.set(demKey, { ...d as ClientDemand, id: d.id || id });
    } else if (d.operationType || d.gateId || d.bayNo || d.driverName) {
      operationsList.push({ ...d as LoadUnloadEntry, id });
    }
  });

  return {
    operations: operationsList,
    inwards: Array.from(inwardsMap.values()),
    invoices: Array.from(invoicesMap.values()),
    audits: Array.from(auditsMap.values()),
    products: Array.from(productsMap.values()),
    parties: Array.from(partiesMap.values()),
    transporters: Array.from(transportersMap.values()),
    demands: Array.from(demandsMap.values())
  };
};

export const addOperationWithAddDoc = async (data: any): Promise<string> => {
  const colRef = collection(db, COLLECTIONS.OPERATIONS);
  const cleanData: Record<string, any> = {
    ...data,
    entryDate: data.entryDate || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  Object.keys(cleanData).forEach(key => {
    if (cleanData[key] === undefined) delete cleanData[key];
  });
  const res = await addDoc(colRef, cleanData);
  return res.id;
};

export const subscribeToSecurityLogs = (
  callback: (data: SecurityGateEntry[]) => void,
  onError?: (err: any) => void
) => {
  console.log(`[Firestore Sub] Connecting to collection: ${COLLECTIONS.SECURITY_LOGS}`);
  const colRef = collection(db, COLLECTIONS.SECURITY_LOGS);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: SecurityGateEntry[] = [];
      snapshot.forEach((docSnap) => {
        const item = docSnap.data() as SecurityGateEntry;
        list.push({ ...item, id: docSnap.id });
      });
      console.log(`[Firestore Sync] ${COLLECTIONS.SECURITY_LOGS} snapshot received: ${list.length} docs (fromCache: ${snapshot.metadata.fromCache})`);
      callback(list);
    },
    (err) => {
      console.error(`[Firestore Error] ${COLLECTIONS.SECURITY_LOGS} sync error:`, err?.code, err?.message);
      if (err?.code === 'unavailable') {
        console.warn('Firestore Security Logs offline; serving from local cache.');
      } else {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.SECURITY_LOGS);
      }
      if (onError) onError(err);
    }
  );
};

export const subscribeToPlanEntries = (
  callback: (data: PlanEntry[]) => void,
  onError?: (err: any) => void,
  startDateIso?: string,
  endDateIso?: string
) => {
  console.log(`[Firestore Sub] Connecting to collection: ${COLLECTIONS.PLAN_ENTRIES}`);
  const colRef = collection(db, COLLECTIONS.PLAN_ENTRIES);
  
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: PlanEntry[] = [];
      snapshot.forEach((docSnap) => {
        const item = { ...(docSnap.data() as PlanEntry), id: docSnap.id };
        if (startDateIso && endDateIso) {
          const itemRaw = item.date || item.planDate || item.targetDate || item.entryDate || item.createdAt || item.updatedAt || '';
          let dateStr = itemRaw;
          if (!dateStr && item.id.startsWith('PLAN-')) {
            const m = item.id.match(/PLAN-(\d{12,14})/);
            if (m) dateStr = new Date(Number(m[1])).toISOString();
          }
          if (dateStr) {
            const itemYmd = dateStr.slice(0, 10);
            const startYmd = startDateIso.slice(0, 10);
            const endYmd = endDateIso.slice(0, 10);
            if (itemYmd < startYmd || itemYmd > endYmd) {
              return;
            }
          } else {
            return;
          }
        }
        list.push(item);
      });

      list.sort((a, b) => {
        const aTime = a.updatedAt || a.date || a.createdAt ? new Date(a.updatedAt || a.date || a.createdAt || '').getTime() : 0;
        const bTime = b.updatedAt || b.date || b.createdAt ? new Date(b.updatedAt || b.date || b.createdAt || '').getTime() : 0;
        return bTime - aTime;
      });

      console.log(`[Firestore Sync] ${COLLECTIONS.PLAN_ENTRIES} snapshot received: ${list.length} docs matching filter (fromCache: ${snapshot.metadata.fromCache})`);
      callback(list);
    },
    (err) => {
      console.error(`[Firestore Error] ${COLLECTIONS.PLAN_ENTRIES} sync error:`, err?.code, err?.message);
      if (err?.code === 'unavailable') {
        console.warn('Firestore Plan Entries offline; serving from local cache.');
      } else {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.PLAN_ENTRIES);
      }
      if (onError) onError(err);
    }
  );
};

export const subscribeToTrackingRecords = (
  callback: (data: TrackingRecord[]) => void,
  onError?: (err: any) => void,
  startDateIso?: string,
  endDateIso?: string
) => {
  console.log(`[Firestore Sub] Connecting to collection: ${COLLECTIONS.TRACKING_RECORDS}`);
  const colRef = collection(db, COLLECTIONS.TRACKING_RECORDS);
  let q: any = colRef;
  if (startDateIso && endDateIso) {
    q = query(colRef, where('updatedAt', '>=', startDateIso), where('updatedAt', '<=', endDateIso));
  }
  return onSnapshot(
    q,
    (snapshot) => {
      const list: TrackingRecord[] = [];
      snapshot.forEach((docSnap) => {
        const item = docSnap.data() as TrackingRecord;
        list.push({ ...item, id: docSnap.id });
      });
      console.log(`[Firestore Sync] ${COLLECTIONS.TRACKING_RECORDS} snapshot received: ${list.length} docs (fromCache: ${snapshot.metadata.fromCache})`);
      callback(list);
    },
    (err) => {
      console.error(`[Firestore Error] ${COLLECTIONS.TRACKING_RECORDS} sync error:`, err?.code, err?.message);
      if (err?.code === 'unavailable') {
        console.warn('Firestore Tracking Records offline; serving from local cache.');
      } else {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.TRACKING_RECORDS);
      }
      if (onError) onError(err);
    }
  );
};

export const subscribeToUsers = (
  callback: (data: UserAccount[]) => void,
  onError?: (err: any) => void
) => {
  console.log(`[Firestore Sub] Connecting to collection: ${COLLECTIONS.USERS}`);
  const colRef = collection(db, COLLECTIONS.USERS);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: UserAccount[] = [];
      snapshot.forEach((docSnap) => {
        const item = docSnap.data() as UserAccount;
        list.push({ ...item, user: docSnap.id });
      });
      console.log(`[Firestore Sync] ${COLLECTIONS.USERS} snapshot received: ${list.length} docs (fromCache: ${snapshot.metadata.fromCache})`);
      callback(list);
    },
    (err) => {
      console.error(`[Firestore Error] ${COLLECTIONS.USERS} sync error:`, err?.code, err?.message);
      if (err?.code === 'unavailable') {
        console.warn('Firestore Users offline; serving from local cache.');
      } else {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.USERS);
      }
      if (onError) onError(err);
    }
  );
};

export const subscribeToMasterList = (
  collectionName: string,
  callback: (data: string[]) => void,
  onError?: (err: any) => void
) => {
  console.log(`[Firestore Sub] Connecting to master collection: ${collectionName}`);
  const colRef = collection(db, collectionName);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const docsData: { name: string; order?: number }[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const val = data?.name || docSnap.id;
        if (val) {
          docsData.push({
            name: String(val).trim(),
            order: typeof data?.order === 'number' ? data.order : 999999
          });
        }
      });
      // Sort by original inserted order
      docsData.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const list = docsData.map((d) => d.name);
      console.log(`[Firestore Sync] Master collection ${collectionName} snapshot received: ${list.length} items (fromCache: ${snapshot.metadata.fromCache})`);
      if (list.length > 0) {
        callback(list);
      }
    },
    (err) => {
      console.error(`[Firestore Error] Master collection ${collectionName} sync error:`, err?.code, err?.message);
      if (err?.code === 'unavailable') {
        console.warn(`Firestore ${collectionName} offline; using local cache.`);
      } else {
        handleFirestoreError(err, OperationType.GET, collectionName);
      }
      if (onError) onError(err);
    }
  );
};

// ==========================================
// FIRESTORE CRUD OPERATIONS (addDoc, setDoc, deleteDoc)
// ==========================================

// Operations (Loading / Unloading)
export const saveOperationToFirestore = async (op: LoadUnloadEntry): Promise<string> => {
  const cleanData: Record<string, any> = {
    ...op,
    entryDate: op.entryDate || new Date().toISOString().split('T')[0],
    totalCases: op.totalCases !== undefined && op.totalCases !== ('' as any) ? Number(op.totalCases) : 0,
    damagedCases: op.damagedCases !== undefined && op.damagedCases !== ('' as any) ? Number(op.damagedCases) : 0,
    damagedValue: op.damagedValue !== undefined && op.damagedValue !== ('' as any) ? Number(op.damagedValue) : 0,
    updatedAt: new Date().toISOString()
  };

  // Remove undefined values
  Object.keys(cleanData).forEach(key => {
    if (cleanData[key] === undefined) {
      delete cleanData[key];
    }
  });

  if (op.id && !op.id.startsWith('temp-')) {
    const docRef = doc(db, COLLECTIONS.OPERATIONS, op.id);
    await setDoc(docRef, cleanData, { merge: true });
    return op.id;
  } else {
    const colRef = collection(db, COLLECTIONS.OPERATIONS);
    const res = await addDoc(colRef, cleanData);
    return res.id;
  }
};

export const deleteOperationFromFirestore = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTIONS.OPERATIONS, id);
  await deleteDoc(docRef);
};

// Security Gate Logs
export const saveSecurityEntryToFirestore = async (entry: SecurityGateEntry): Promise<string> => {
  const cleanData: Record<string, any> = {
    ...entry,
    entryDate: entry.entryDate || new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString()
  };
  Object.keys(cleanData).forEach(key => {
    if (cleanData[key] === undefined) delete cleanData[key];
  });

  if (entry.id && !entry.id.startsWith('temp-')) {
    const docRef = doc(db, COLLECTIONS.SECURITY_LOGS, entry.id);
    await setDoc(docRef, cleanData, { merge: true });
    return entry.id;
  } else {
    const colRef = collection(db, COLLECTIONS.SECURITY_LOGS);
    const res = await addDoc(colRef, cleanData);
    return res.id;
  }
};

export const deleteSecurityEntryFromFirestore = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTIONS.SECURITY_LOGS, id);
  await deleteDoc(docRef);
};

// Plan Entries
export const savePlanEntriesToFirestore = async (entries: PlanEntry[]): Promise<void> => {
  const todayIso = new Date().toISOString().split('T')[0];
  for (const entry of entries) {
    const cleanData: Record<string, any> = {
      ...entry,
      date: entry.date || entry.planDate || entry.targetDate || entry.entryDate || todayIso,
      updatedAt: new Date().toISOString()
    };
    Object.keys(cleanData).forEach(key => {
      if (cleanData[key] === undefined) delete cleanData[key];
    });
    if (entry.id && !entry.id.startsWith('temp-')) {
      const docRef = doc(db, COLLECTIONS.PLAN_ENTRIES, entry.id);
      await setDoc(docRef, cleanData, { merge: true });
    } else {
      const colRef = collection(db, COLLECTIONS.PLAN_ENTRIES);
      await addDoc(colRef, cleanData);
    }
  }
};

export const deletePlanEntryFromFirestore = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTIONS.PLAN_ENTRIES, id);
  await deleteDoc(docRef);
};

// Tracking Records
export const saveTrackingRecordsToFirestore = async (records: TrackingRecord[]): Promise<void> => {
  for (const rec of records) {
    const cleanData: Record<string, any> = {
      ...rec,
      updatedAt: new Date().toISOString()
    };
    if (rec.id && !rec.id.startsWith('temp-')) {
      const docRef = doc(db, COLLECTIONS.TRACKING_RECORDS, rec.id);
      await setDoc(docRef, cleanData, { merge: true });
    } else {
      const colRef = collection(db, COLLECTIONS.TRACKING_RECORDS);
      await addDoc(colRef, cleanData);
    }
  }
};

export const deleteTrackingRecordFromFirestore = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTIONS.TRACKING_RECORDS, id);
  await deleteDoc(docRef);
};

// User Accounts
export const saveUserToFirestore = async (user: UserAccount): Promise<void> => {
  const docRef = doc(db, COLLECTIONS.USERS, user.user.toLowerCase().trim());
  await setDoc(docRef, {
    user: user.user.toLowerCase().trim(),
    pass: user.pass,
    role: user.role,
    name: user.name || user.user,
    updatedAt: new Date().toISOString()
  });
};

// Master Lists Bulk Sync & Reconciliation (Replaces and cleans old items with no limitation)
export const syncMasterListToFirestore = async (collectionName: string, items: string[]): Promise<void> => {
  try {
    const colRef = collection(db, collectionName);
    const snapshot = await getDocs(colRef);
    
    // Create clean unique list of items
    const seen = new Set<string>();
    const validItems: string[] = [];
    for (const raw of items) {
      if (raw !== undefined && raw !== null) {
        const clean = String(raw).trim();
        if (clean.length > 0 && !seen.has(clean.toUpperCase())) {
          seen.add(clean.toUpperCase());
          validItems.push(clean);
        }
      }
    }

    // 1. Delete existing documents in chunks of 400 using writeBatch
    const existingDocIds: string[] = [];
    snapshot.forEach((docSnap) => {
      existingDocIds.push(docSnap.id);
    });

    for (let i = 0; i < existingDocIds.length; i += 400) {
      const batch = writeBatch(db);
      const chunk = existingDocIds.slice(i, i + 400);
      chunk.forEach((id) => {
        batch.delete(doc(db, collectionName, id));
      });
      await batch.commit();
    }

    // 2. Insert all items in chunks of 400 using writeBatch with safe doc IDs
    const getDocId = (name: string, index: number) => {
      const clean = name.replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase().slice(0, 80);
      return clean.length > 0 ? `${clean}_${index}` : `ITEM_${index}`;
    };

    for (let i = 0; i < validItems.length; i += 400) {
      const batch = writeBatch(db);
      const chunk = validItems.slice(i, i + 400);
      chunk.forEach((item, chunkIdx) => {
        const itemIdx = i + chunkIdx;
        const docId = getDocId(item, itemIdx);
        batch.set(doc(db, collectionName, docId), {
          name: item,
          order: itemIdx,
          updatedAt: new Date().toISOString()
        });
      });
      await batch.commit();
    }
  } catch (error) {
    console.error(`Error syncing master list for ${collectionName}:`, error);
  }
};

export const archivePlanEntriesToFirestore = async (entries: PlanEntry[]): Promise<void> => {
  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();
    entries.forEach((entry) => {
      // Add to archived collection
      const archivedRef = doc(db, COLLECTIONS.ARCHIVED_PLAN_ENTRIES, entry.id);
      batch.set(archivedRef, {
        ...entry,
        status: 'Confirmed Plan',
        archivedAt: (entry as any).archivedAt || nowIso,
        updatedAt: nowIso
      });
      
      // Delete from active collection
      const activeRef = doc(db, COLLECTIONS.PLAN_ENTRIES, entry.id);
      batch.delete(activeRef);
    });
    await batch.commit();
  } catch (error) {
    console.error('Error archiving plan entries:', error);
    throw error;
  }
};

export const subscribeToArchivedPlanEntries = (
  callback: (data: PlanEntry[]) => void,
  startDate?: string,
  endDate?: string
) => {
  const colRef = collection(db, COLLECTIONS.ARCHIVED_PLAN_ENTRIES);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: PlanEntry[] = [];
      snapshot.forEach((docSnap) => {
        const item = { ...(docSnap.data() as PlanEntry), id: docSnap.id };
        if (startDate && endDate) {
          const itemRaw = (item as any).archivedAt || item.date || item.planDate || item.targetDate || item.entryDate || item.updatedAt || item.createdAt || '';
          let dateStr = itemRaw;
          if (!dateStr && item.id.startsWith('PLAN-')) {
            const m = item.id.match(/PLAN-(\d{12,14})/);
            if (m) dateStr = new Date(Number(m[1])).toISOString();
          }
          if (dateStr) {
            const itemYmd = dateStr.slice(0, 10);
            const startYmd = startDate.slice(0, 10);
            const endYmd = endDate.slice(0, 10);
            if (itemYmd < startYmd || itemYmd > endYmd) {
              return;
            }
          } else {
            return;
          }
        }
        list.push(item);
      });

      list.sort((a, b) => {
        const aTime = (a as any).archivedAt || a.updatedAt ? new Date((a as any).archivedAt || a.updatedAt || '').getTime() : 0;
        const bTime = (b as any).archivedAt || b.updatedAt ? new Date((b as any).archivedAt || b.updatedAt || '').getTime() : 0;
        return bTime - aTime;
      });

      callback(list);
    },
    (err) => {
      if (err?.code === 'unavailable') {
        console.warn('Firestore Archived Plan Entries offline; serving from local cache.');
      } else {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.ARCHIVED_PLAN_ENTRIES);
      }
    }
  );
};

// ==========================================
// THERMOCOL & PACKING MATERIAL FIRESTORE SYNC
// ==========================================

export const subscribeToThermocolInwards = (
  callback: (data: ThermocolInward[]) => void,
  onError?: (err: any) => void
) => {
  const colRefMain = collection(db, COLLECTIONS.PACKING_INWARDS);
  const colRefLegacy = collection(db, COLLECTIONS.TH_INWARDS);
  const colRefOps = collection(db, COLLECTIONS.OPERATIONS);
  const docRefStore = doc(db, COLLECTIONS.THERMOCOL_PACKING, 'inwards');

  let mainItems: ThermocolInward[] = [];
  let legacyItems: ThermocolInward[] = [];
  let opsItems: ThermocolInward[] = [];
  let storeItems: ThermocolInward[] = [];

  const mergeAndEmit = () => {
    const map = new Map<string, ThermocolInward>();
    [...legacyItems, ...storeItems, ...opsItems, ...mainItems].forEach(item => {
      const id = item.id;
      if (id && (item.grNo || item.productName || (item as any).type === 'INWARD' || item.receiveDate)) {
        map.set(id, { ...item, id });
      }
    });
    const combined = Array.from(map.values());
    console.log(`[Firestore Sync] Real-time Packing Inwards snapshot merged: ${combined.length} records`);
    callback(combined);
  };

  const unsubMain = onSnapshot(
    colRefMain,
    (snapshot) => {
      const list: ThermocolInward[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as ThermocolInward;
        list.push({ ...d, id: d.id || docSnap.id });
      });
      mainItems = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('Packing Inwards sync error:', err);
      if (onError) onError(err);
    }
  );

  const unsubOps = onSnapshot(
    colRefOps,
    (snapshot) => {
      const list: ThermocolInward[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d && (d.type === 'INWARD' || d.grNo || d.productName) && (d.initialQty !== undefined || d.availableQty !== undefined)) {
          list.push({ ...d as ThermocolInward, id: d.id || docSnap.id });
        }
      });
      opsItems = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('ich_operations inwards sync error:', err);
    }
  );

  const unsubLegacy = onSnapshot(
    colRefLegacy,
    (snapshot) => {
      const list: ThermocolInward[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as ThermocolInward;
        list.push({ ...d, id: d.id || docSnap.id });
      });
      legacyItems = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('TH Inwards sync error:', err);
    }
  );

  const unsubStore = onSnapshot(
    docRefStore,
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.items)) {
          storeItems = data.items;
          mergeAndEmit();
        }
      }
    },
    (err) => {
      console.warn('Thermocol Store Inwards sync error:', err);
    }
  );

  return () => {
    unsubMain();
    unsubOps();
    unsubLegacy();
    unsubStore();
  };
};

export const subscribeToThermocolInvoices = (
  callback: (data: ThermocolInvoice[]) => void,
  onError?: (err: any) => void
) => {
  const colRefMain = collection(db, COLLECTIONS.PACKING_OUTWARDS);
  const colRefLegacy = collection(db, COLLECTIONS.TH_INVOICES);
  const colRefOps = collection(db, COLLECTIONS.OPERATIONS);
  const docRefStore = doc(db, COLLECTIONS.THERMOCOL_PACKING, 'invoices');

  let mainInvoices: ThermocolInvoice[] = [];
  let legacyInvoices: ThermocolInvoice[] = [];
  let opsInvoices: ThermocolInvoice[] = [];
  let storeInvoices: ThermocolInvoice[] = [];

  const mergeAndEmit = () => {
    const map = new Map<string, ThermocolInvoice>();

    // Process legacy, store, ops, main so latest/main overrides
    [...legacyInvoices, ...storeInvoices, ...opsInvoices, ...mainInvoices].forEach(item => {
      const invNo = item.invNo || (item as any).id;
      if (invNo && (item.items || (item as any).type === 'INVOICE')) {
        let normalizedInvNo = invNo;
        if (!normalizedInvNo.includes('/') && normalizedInvNo.includes('_26')) {
          normalizedInvNo = normalizedInvNo.replace(/_26$/, '/26');
        }
        const company = item.company || (normalizedInvNo.startsWith('AHPL') ? 'HPL' : 'AIL');
        map.set(normalizedInvNo, {
          ...item,
          invNo: normalizedInvNo,
          company
        });
      }
    });

    const combined = Array.from(map.values());
    combined.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return b.invNo.localeCompare(a.invNo);
    });

    console.log(`[Firestore Sync] Real-time Packing Outwards / Delivery Challans snapshot merged: ${combined.length} invoices`);
    callback(combined);
  };

  const unsubMain = onSnapshot(
    colRefMain,
    (snapshot) => {
      const list: ThermocolInvoice[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as ThermocolInvoice;
        let invNo = d.invNo || docSnap.id;
        if (!invNo.includes('/') && invNo.includes('_26')) {
          invNo = invNo.replace(/_26$/, '/26');
        }
        list.push({ ...d, invNo });
      });
      mainInvoices = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('Packing Outwards sync error:', err);
      if (onError) onError(err);
    }
  );

  const unsubOps = onSnapshot(
    colRefOps,
    (snapshot) => {
      const list: ThermocolInvoice[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d && (d.invNo || d.type === 'INVOICE') && d.items) {
          let invNo = d.invNo || docSnap.id;
          if (!invNo.includes('/') && invNo.includes('_26')) {
            invNo = invNo.replace(/_26$/, '/26');
          }
          list.push({ ...d as ThermocolInvoice, invNo });
        }
      });
      opsInvoices = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('ich_operations invoices sync error:', err);
    }
  );

  const unsubLegacy = onSnapshot(
    colRefLegacy,
    (snapshot) => {
      const list: ThermocolInvoice[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as ThermocolInvoice;
        let invNo = d.invNo || docSnap.id;
        if (!invNo.includes('/') && invNo.includes('_26')) {
          invNo = invNo.replace(/_26$/, '/26');
        }
        list.push({ ...d, invNo });
      });
      legacyInvoices = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('TH Invoices sync error:', err);
    }
  );

  const unsubStore = onSnapshot(
    docRefStore,
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.items)) {
          storeInvoices = data.items.map((item: any) => {
            let invNo = item.invNo || item.id || '';
            if (!invNo.includes('/') && invNo.includes('_26')) {
              invNo = invNo.replace(/_26$/, '/26');
            }
            return { ...item, invNo };
          });
          mergeAndEmit();
        }
      }
    },
    (err) => {
      console.warn('Thermocol Store Invoices sync error:', err);
    }
  );

  return () => {
    unsubMain();
    unsubOps();
    unsubLegacy();
    unsubStore();
  };
};

export const subscribeToThermocolProducts = (
  callback: (data: ThermocolProduct[]) => void,
  onError?: (err: any) => void
) => {
  const colRef = collection(db, COLLECTIONS.TH_PRODUCTS);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map = new Map<string, ThermocolProduct>();
      snapshot.forEach((docSnap) => {
        const p = docSnap.data() as ThermocolProduct;
        if (p && p.name && p.name.trim()) {
          const comp = p.company || 'AIL';
          const key = `${comp}_${p.name.trim().toLowerCase()}`;
          if (!map.has(key)) {
            map.set(key, { ...p, id: docSnap.id });
          }
        }
      });
      callback(Array.from(map.values()));
    },
    (err) => {
      console.warn('Thermocol Products sync error:', err);
      if (onError) onError(err);
    }
  );
};

export const subscribeToThermocolParties = (
  callback: (data: ThermocolParty[]) => void,
  onError?: (err: any) => void
) => {
  const colRef = collection(db, COLLECTIONS.TH_PARTIES);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map = new Map<string, ThermocolParty>();
      snapshot.forEach((docSnap) => {
        const p = docSnap.data() as ThermocolParty;
        if (p && p.name && p.name.trim()) {
          const comp = p.company || 'AIL';
          const key = `${comp}_${p.name.trim().toLowerCase()}`;
          if (!map.has(key)) {
            map.set(key, p);
          }
        }
      });
      callback(Array.from(map.values()));
    },
    (err) => {
      console.warn('Thermocol Parties sync error:', err);
      if (onError) onError(err);
    }
  );
};

export const subscribeToThermocolTransporters = (
  callback: (data: ThermocolTransporter[]) => void,
  onError?: (err: any) => void
) => {
  const colRef = collection(db, COLLECTIONS.TH_TRANSPORTERS);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map = new Map<string, ThermocolTransporter>();
      snapshot.forEach((docSnap) => {
        const t = docSnap.data() as ThermocolTransporter;
        if (t && t.name && t.name.trim()) {
          const comp = t.company || 'AIL';
          const key = `${comp}_${t.name.trim().toLowerCase()}`;
          if (!map.has(key)) {
            map.set(key, t);
          }
        }
      });
      callback(Array.from(map.values()));
    },
    (err) => {
      console.warn('Thermocol Transporters sync error:', err);
      if (onError) onError(err);
    }
  );
};

export const subscribeToThermocolDemands = (
  callback: (data: ClientDemand[]) => void,
  onError?: (err: any) => void
) => {
  const colRef = collection(db, COLLECTIONS.TH_DEMANDS);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map = new Map<string, ClientDemand>();
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as ClientDemand;
        if (d && d.partyName && d.productName) {
          const comp = d.company || 'AIL';
          const key = `${comp}_${d.partyName.trim().toLowerCase()}_${d.productName.trim().toLowerCase()}`;
          if (!map.has(key)) {
            map.set(key, { ...d, id: docSnap.id });
          }
        }
      });
      callback(Array.from(map.values()));
    },
    (err) => {
      console.warn('Thermocol Demands sync error:', err);
      if (onError) onError(err);
    }
  );
};

export const subscribeToThermocolAudits = (
  callback: (data: InvoiceAuditLog[]) => void,
  onError?: (err: any) => void
) => {
  const colRefMain = collection(db, 'packing_audits');
  const colRefLegacy = collection(db, COLLECTIONS.TH_AUDITS);
  const docRefStore = doc(db, COLLECTIONS.THERMOCOL_PACKING, 'audits');

  let mainAudits: InvoiceAuditLog[] = [];
  let legacyAudits: InvoiceAuditLog[] = [];
  let storeAudits: InvoiceAuditLog[] = [];

  const mergeAndEmit = () => {
    const map = new Map<string, InvoiceAuditLog>();
    [...legacyAudits, ...storeAudits, ...mainAudits].forEach(item => {
      if (item.id) map.set(item.id, item);
    });
    const combined = Array.from(map.values());
    combined.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    callback(combined);
  };

  const unsubMain = onSnapshot(
    colRefMain,
    (snapshot) => {
      const list: InvoiceAuditLog[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as InvoiceAuditLog;
        list.push({ ...d, id: d.id || docSnap.id });
      });
      mainAudits = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('packing_audits sync error:', err);
      if (onError) onError(err);
    }
  );

  const unsubLegacy = onSnapshot(
    colRefLegacy,
    (snapshot) => {
      const list: InvoiceAuditLog[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as InvoiceAuditLog;
        list.push({ ...d, id: d.id || docSnap.id });
      });
      legacyAudits = list;
      mergeAndEmit();
    },
    (err) => {
      console.warn('TH Audits sync error:', err);
    }
  );

  const unsubStore = onSnapshot(
    docRefStore,
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.items)) {
          storeAudits = data.items;
          mergeAndEmit();
        }
      }
    },
    (err) => {
      console.warn('Thermocol Store Audits sync error:', err);
    }
  );

  return () => {
    unsubMain();
    unsubLegacy();
    unsubStore();
  };
};

export const saveCompanyConfigToFirestore = async (senderAIL: any, senderHPL: any): Promise<void> => {
  const docRef = doc(db, COLLECTIONS.TH_SEQUENCES, 'company_config');
  await setDoc(docRef, {
    senderAIL,
    senderHPL,
    updatedAt: new Date().toISOString()
  }, { merge: true });
};

export const subscribeToCompanyConfig = (
  callback: (config: { senderAIL?: any; senderHPL?: any }) => void
) => {
  const docRef = doc(db, COLLECTIONS.TH_SEQUENCES, 'company_config');
  return onSnapshot(
    docRef,
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        callback({
          senderAIL: data.senderAIL,
          senderHPL: data.senderHPL
        });
      }
    },
    (err) => {
      console.warn('Company Config sync error:', err);
    }
  );
};

export const subscribeToThermocolSequences = (
  callback: (seq: { seqAIL: number; seqHPL: number; challanSeqAIL: number; challanSeqHPL: number }) => void
) => {
  const docRef = doc(db, COLLECTIONS.TH_SEQUENCES, 'current_counters');
  return onSnapshot(
    docRef,
    (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        callback({
          seqAIL: Number(data.seqAIL) || 392,
          seqHPL: Number(data.seqHPL) || 1,
          challanSeqAIL: Number(data.challanSeqAIL) || 1,
          challanSeqHPL: Number(data.challanSeqHPL) || 1
        });
      }
    },
    (err) => {
      console.warn('Thermocol Sequences sync error:', err);
    }
  );
};

// CRUD / Batch Sync Mutators for Thermocol Collections

export const saveThermocolInwardToFirestore = async (inward: ThermocolInward): Promise<string> => {
  const docId = inward.id || `inw_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const cleanData = {
    ...inward,
    type: 'INWARD',
    id: docId,
    updatedAt: new Date().toISOString()
  };

  // Write to packing_inwards, ich_th_inwards, and ich_operations
  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.PACKING_INWARDS, docId), cleanData, { merge: true });
  batch.set(doc(db, COLLECTIONS.TH_INWARDS, docId), cleanData, { merge: true });
  batch.set(doc(db, COLLECTIONS.OPERATIONS, docId), cleanData, { merge: true });
  await batch.commit();

  return docId;
};

export const saveThermocolInwardsBatchToFirestore = async (inwards: ThermocolInward[]): Promise<void> => {
  for (let i = 0; i < inwards.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = inwards.slice(i, i + 400);
    chunk.forEach((inw) => {
      const docId = inw.id || `inw_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const cleanData = { ...inw, type: 'INWARD', id: docId, updatedAt: new Date().toISOString() };
      batch.set(doc(db, COLLECTIONS.PACKING_INWARDS, docId), cleanData, { merge: true });
      batch.set(doc(db, COLLECTIONS.TH_INWARDS, docId), cleanData, { merge: true });
      batch.set(doc(db, COLLECTIONS.OPERATIONS, docId), cleanData, { merge: true });
    });
    await batch.commit();
  }
};

export const saveThermocolInvoiceToFirestore = async (invoice: ThermocolInvoice): Promise<string> => {
  if (!invoice || !invoice.invNo) {
    throw new Error('Cannot save invoice without valid invNo');
  }

  const safeId = invoice.invNo.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Sanitize line items to ensure numbers, strings, and no undefined properties
  const sanitizedItems = (invoice.items || []).map((it, idx) => ({
    id: it.id || `item_${idx}_${Date.now()}`,
    productId: it.productId || '',
    productName: it.productName || '',
    hsnCode: it.hsnCode || '3923',
    packSize: it.packSize || '',
    packSizeMultiple: Number(it.packSizeMultiple) || 1,
    cases: Number(it.cases) || 1,
    qty: Number(it.qty) || 0,
    rate: Number(it.rate) || 0,
    weight: Number(it.weight) || 0,
    cft: Number(it.cft) || 0,
    taxableValue: it.taxableValue !== undefined ? String(it.taxableValue) : '0',
    gstValue: it.gstValue !== undefined ? String(it.gstValue) : '0',
    totalValue: it.totalValue !== undefined ? String(it.totalValue) : '0',
    batch: it.batch ? String(it.batch).trim() : '',
    exp: it.exp ? String(it.exp).trim() : ''
  }));

  const cleanPayload = deepSanitizeForFirestore({
    ...invoice,
    items: sanitizedItems,
    type: 'INVOICE',
    invNo: invoice.invNo,
    company: invoice.company || (invoice.invNo.startsWith('AHPL') ? 'HPL' : 'AIL'),
    date: invoice.date || new Date().toISOString().split('T')[0],
    partyName: invoice.partyName || '',
    partyAddress: invoice.partyAddress || '',
    partyGstin: invoice.partyGstin || '',
    partyCity: invoice.partyCity || '',
    partyState: invoice.partyState || '',
    partyPincode: invoice.partyPincode || '',
    totalTaxable: String(invoice.totalTaxable || '0'),
    totalGst: String(invoice.totalGst || '0'),
    grandTotal: String(invoice.grandTotal || '0'),
    totalQty: Number(invoice.totalQty) || 0,
    totalCases: Number(invoice.totalCases) || 0,
    totalWeight: Number(invoice.totalWeight) || 0,
    totalCft: Number(invoice.totalCft) || 0,
    senderName: invoice.senderName || '',
    senderAddress: invoice.senderAddress || '',
    senderGstin: invoice.senderGstin || '',
    senderPan: invoice.senderPan || '',
    senderCin: invoice.senderCin || '',
    senderContact: invoice.senderContact || '',
    senderEmail: invoice.senderEmail || '',
    transName: invoice.transName || '',
    transGstin: invoice.transGstin || '',
    lrNo: invoice.lrNo || '',
    lrDate: invoice.lrDate || '',
    vehicleNo: invoice.vehicleNo || '',
    taxType: invoice.taxType || (invoice.isInterState ? 'INTER_STATE_IGST' : 'LOCAL_EXEMPT'),
    isInterState: Boolean(invoice.isInterState),
    createdAt: invoice.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // 1. Mandatory Primary Save to 'ich_operations'
  const opsDocRef = doc(db, COLLECTIONS.OPERATIONS, safeId);
  await setDoc(opsDocRef, cleanPayload, { merge: true });
  console.log(`[Firestore Success] Saved invoice ${invoice.invNo} to ${COLLECTIONS.OPERATIONS} (doc: ${safeId})`);


  // 3. Multi-Collection Synchronization for cross-view redundancy
  try {
    const outwardsRef = doc(db, COLLECTIONS.PACKING_OUTWARDS, safeId);
    await setDoc(outwardsRef, cleanPayload, { merge: true });
    const legacyRef = doc(db, COLLECTIONS.TH_INVOICES, safeId);
    await setDoc(legacyRef, cleanPayload, { merge: true });
  } catch (secErr) {
    console.warn('[Firestore Notice] Secondary outwards sync:', secErr);
  }

  return safeId;
};

export const deleteThermocolInvoiceFromFirestore = async (invNo: string): Promise<void> => {
  const safeId = invNo.replace(/[^a-zA-Z0-9_-]/g, '_');
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTIONS.PACKING_OUTWARDS, safeId));
  batch.delete(doc(db, COLLECTIONS.TH_INVOICES, safeId));
  batch.delete(doc(db, COLLECTIONS.OPERATIONS, safeId));
  await batch.commit();

  try {
    const q1 = query(collection(db, COLLECTIONS.PACKING_OUTWARDS), where("invNo", "==", invNo));
    const snap1 = await getDocs(q1);
    for (const d of snap1.docs) {
      await deleteDoc(d.ref);
    }

    const q2 = query(collection(db, COLLECTIONS.TH_INVOICES), where("invNo", "==", invNo));
    const snap2 = await getDocs(q2);
    for (const d of snap2.docs) {
      await deleteDoc(d.ref);
    }

    const q3 = query(collection(db, COLLECTIONS.OPERATIONS), where("invNo", "==", invNo));
    const snap3 = await getDocs(q3);
    for (const d of snap3.docs) {
      await deleteDoc(d.ref);
    }
  } catch (err) {
    console.warn('[Firestore] Error deleting invNo query docs:', err);
  }

  // Also clean up from thermocol_packing/invoices store doc
  try {
    const storeRef = doc(db, COLLECTIONS.THERMOCOL_PACKING, 'invoices');
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      const data = storeSnap.data();
      if (Array.isArray(data.items)) {
        const filtered = data.items.filter((item: any) => 
          item.invNo !== invNo && 
          item.id !== invNo && 
          item.id !== safeId && 
          item.invNo !== safeId
        );
        await setDoc(storeRef, { items: filtered, updatedAt: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.warn('[Firestore] Error filtering store invoices:', err);
  }
};

export const deleteThermocolInwardFromFirestore = async (inwardId: string): Promise<void> => {
  if (!inwardId) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTIONS.PACKING_INWARDS, inwardId));
  batch.delete(doc(db, COLLECTIONS.TH_INWARDS, inwardId));
  await batch.commit();

  try {
    const q1 = query(collection(db, COLLECTIONS.PACKING_INWARDS), where("id", "==", inwardId));
    const snap1 = await getDocs(q1);
    for (const d of snap1.docs) {
      await deleteDoc(d.ref);
    }
  } catch (err) {
    console.warn('[Firestore] Error query deleting inward:', err);
  }
};

export const deleteThermocolProductFromFirestore = async (productId: string, name?: string, company?: string): Promise<void> => {
  const comp = company || 'AIL';
  const safeId = name ? `${comp}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80) : productId;
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTIONS.TH_PRODUCTS, safeId));
  batch.delete(doc(db, COLLECTIONS.TH_PRODUCTS, productId));
  await batch.commit();
};

export const deleteThermocolPartyFromFirestore = async (partyName: string, company?: string): Promise<void> => {
  const comp = company || 'AIL';
  const safeId = `${comp}_${partyName}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTIONS.TH_PARTIES, safeId));
  batch.delete(doc(db, COLLECTIONS.PACKING_CUSTOMERS, safeId));
  await batch.commit();

  try {
    const q1 = query(collection(db, COLLECTIONS.PACKING_CUSTOMERS), where("name", "==", partyName));
    const snap1 = await getDocs(q1);
    for (const d of snap1.docs) {
      await deleteDoc(d.ref);
    }
  } catch (err) {
    console.warn('[Firestore] Error query deleting customer:', err);
  }
};

export const deleteThermocolTransporterFromFirestore = async (transName: string, company?: string): Promise<void> => {
  const comp = company || 'AIL';
  const safeId = `${comp}_${transName}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTIONS.TH_TRANSPORTERS, safeId));
  batch.delete(doc(db, COLLECTIONS.PACKING_TRANSPORTERS, safeId));
  await batch.commit();
};

export const saveThermocolProductsToFirestore = async (products: ThermocolProduct[]): Promise<void> => {
  // Deduplicate before saving
  const map = new Map<string, ThermocolProduct>();
  products.forEach(p => {
    if (p.name && p.name.trim()) {
      const comp = p.company || 'AIL';
      const key = `${comp}_${p.name.trim().toLowerCase()}`;
      map.set(key, p);
    }
  });
  const uniqueProducts = Array.from(map.values());

  for (let i = 0; i < uniqueProducts.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = uniqueProducts.slice(i, i + 400);
    chunk.forEach((prod) => {
      const comp = prod.company || 'AIL';
      const safeId = `${comp}_${prod.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
      const docRef = doc(db, COLLECTIONS.TH_PRODUCTS, safeId);
      batch.set(docRef, { ...prod, id: safeId, updatedAt: new Date().toISOString() }, { merge: true });
    });
    await batch.commit();
  }
};

export const saveThermocolPartiesToFirestore = async (parties: ThermocolParty[]): Promise<void> => {
  // Deduplicate before saving
  const map = new Map<string, ThermocolParty>();
  parties.forEach(p => {
    if (p.name && p.name.trim()) {
      const comp = p.company || 'AIL';
      const key = `${comp}_${p.name.trim().toLowerCase()}`;
      map.set(key, p);
    }
  });
  const uniqueParties = Array.from(map.values());

  for (let i = 0; i < uniqueParties.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = uniqueParties.slice(i, i + 400);
    chunk.forEach((party) => {
      const comp = party.company || 'AIL';
      const safeId = `${comp}_${party.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
      const docRef = doc(db, COLLECTIONS.TH_PARTIES, safeId);
      batch.set(docRef, { ...party, updatedAt: new Date().toISOString() }, { merge: true });
    });
    await batch.commit();
  }
};

export const saveThermocolTransportersToFirestore = async (transporters: ThermocolTransporter[]): Promise<void> => {
  // Deduplicate before saving
  const map = new Map<string, ThermocolTransporter>();
  transporters.forEach(t => {
    if (t.name && t.name.trim()) {
      const comp = t.company || 'AIL';
      const key = `${comp}_${t.name.trim().toLowerCase()}`;
      map.set(key, t);
    }
  });
  const uniqueTransporters = Array.from(map.values());

  for (let i = 0; i < uniqueTransporters.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = uniqueTransporters.slice(i, i + 400);
    chunk.forEach((trans) => {
      const comp = trans.company || 'AIL';
      const safeId = `${comp}_${trans.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
      const docRef = doc(db, COLLECTIONS.TH_TRANSPORTERS, safeId);
      batch.set(docRef, { ...trans, updatedAt: new Date().toISOString() }, { merge: true });
    });
    await batch.commit();
  }
};

export const saveThermocolDemandsToFirestore = async (demands: ClientDemand[]): Promise<void> => {
  // Deduplicate before saving
  const map = new Map<string, ClientDemand>();
  demands.forEach(d => {
    if (d.partyName && d.productName) {
      const comp = d.company || 'AIL';
      const key = `${comp}_${d.partyName.trim().toLowerCase()}_${d.productName.trim().toLowerCase()}`;
      map.set(key, d);
    }
  });
  const uniqueDemands = Array.from(map.values());

  for (let i = 0; i < uniqueDemands.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = uniqueDemands.slice(i, i + 400);
    chunk.forEach((d) => {
      const comp = d.company || 'AIL';
      const safeId = `${comp}_${d.partyName}_${d.productName}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
      const docRef = doc(db, COLLECTIONS.TH_DEMANDS, safeId);
      batch.set(docRef, { ...d, id: safeId, updatedAt: new Date().toISOString() }, { merge: true });
    });
    await batch.commit();
  }
};

export const addThermocolAuditLog = async (log: InvoiceAuditLog): Promise<string> => {
  const docId = log.id || `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const cleanData = {
    ...log,
    id: docId,
    updatedAt: new Date().toISOString()
  };

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.TH_AUDITS, docId), cleanData, { merge: true });
  batch.set(doc(db, 'packing_audits', docId), cleanData, { merge: true });
  await batch.commit();

  try {
    await addDoc(collection(db, 'packing_audits'), cleanData);
  } catch (err) {
    console.warn('[Firestore] addDoc packing_audits:', err);
  }

  return docId;
};

export const saveThermocolAuditsToFirestore = async (audits: InvoiceAuditLog[]): Promise<void> => {
  for (let i = 0; i < audits.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = audits.slice(i, i + 400);
    chunk.forEach((aud) => {
      const docId = aud.id || `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const cleanData = { ...aud, id: docId, updatedAt: new Date().toISOString() };
      batch.set(doc(db, COLLECTIONS.TH_AUDITS, docId), cleanData, { merge: true });
      batch.set(doc(db, 'packing_audits', docId), cleanData, { merge: true });
    });
    await batch.commit();
  }
};

export const deleteThermocolAuditLogFromFirestore = async (auditId: string): Promise<void> => {
  if (!auditId) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, COLLECTIONS.TH_AUDITS, auditId));
    batch.delete(doc(db, 'packing_audits', auditId));
    await batch.commit();
  } catch (err) {
    console.warn('[Firestore] Batch delete audit log doc:', err);
  }

  try {
    const q1 = query(collection(db, 'packing_audits'), where("id", "==", auditId));
    const snap1 = await getDocs(q1);
    for (const d of snap1.docs) {
      await deleteDoc(d.ref);
    }
    const q2 = query(collection(db, COLLECTIONS.TH_AUDITS), where("id", "==", auditId));
    const snap2 = await getDocs(q2);
    for (const d of snap2.docs) {
      await deleteDoc(d.ref);
    }

    // Also match by invNo if auditId happened to be invoice number
    const q3 = query(collection(db, 'packing_audits'), where("invNo", "==", auditId));
    const snap3 = await getDocs(q3);
    for (const d of snap3.docs) {
      if (d.data().action === 'CANCEL') {
        await deleteDoc(d.ref);
      }
    }
    const q4 = query(collection(db, COLLECTIONS.TH_AUDITS), where("invNo", "==", auditId));
    const snap4 = await getDocs(q4);
    for (const d of snap4.docs) {
      if (d.data().action === 'CANCEL') {
        await deleteDoc(d.ref);
      }
    }
  } catch (err) {
    console.warn('[Firestore] Error query deleting audit record:', err);
  }

  // Also clean up from thermocol_packing/audits document store if present
  try {
    const storeRef = doc(db, COLLECTIONS.THERMOCOL_PACKING, 'audits');
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      const data = storeSnap.data();
      if (Array.isArray(data.items)) {
        const filtered = data.items.filter((item: any) => item.id !== auditId && !(item.invNo === auditId && item.action === 'CANCEL'));
        await setDoc(storeRef, { items: filtered, updatedAt: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.warn('[Firestore] Error filtering store audits:', err);
  }
};

export const clearThermocolCancelledAuditsFromFirestore = async (): Promise<void> => {
  try {
    const q1 = query(collection(db, 'packing_audits'), where("action", "==", "CANCEL"));
    const snap1 = await getDocs(q1);
    for (const d of snap1.docs) {
      await deleteDoc(d.ref);
    }
    const q2 = query(collection(db, COLLECTIONS.TH_AUDITS), where("action", "==", "CANCEL"));
    const snap2 = await getDocs(q2);
    for (const d of snap2.docs) {
      await deleteDoc(d.ref);
    }

    // Also check all packing_audits for any with deletedAt
    const allAuditsSnap = await getDocs(collection(db, 'packing_audits'));
    for (const d of allAuditsSnap.docs) {
      const data = d.data();
      if (data.action === 'CANCEL' || data.deletedAt) {
        await deleteDoc(d.ref);
      }
    }

    const allThAuditsSnap = await getDocs(collection(db, COLLECTIONS.TH_AUDITS));
    for (const d of allThAuditsSnap.docs) {
      const data = d.data();
      if (data.action === 'CANCEL' || data.deletedAt) {
        await deleteDoc(d.ref);
      }
    }
  } catch (err) {
    console.warn('[Firestore] Error clearing cancelled audit records:', err);
  }

  // Clean up from thermocol_packing/audits document store
  try {
    const storeRef = doc(db, COLLECTIONS.THERMOCOL_PACKING, 'audits');
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      const data = storeSnap.data();
      if (Array.isArray(data.items)) {
        const filtered = data.items.filter((item: any) => item.action !== 'CANCEL' && !item.deletedAt);
        await setDoc(storeRef, { items: filtered, updatedAt: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.warn('[Firestore] Error filtering store audits on purge:', err);
  }
};

export const saveThermocolSequencesToFirestore = async (
  seqAIL: number, 
  seqHPL: number, 
  challanSeqAIL: number = 1, 
  challanSeqHPL: number = 1
): Promise<void> => {
  const docRef = doc(db, COLLECTIONS.TH_SEQUENCES, 'current_counters');
  await setDoc(docRef, {
    seqAIL,
    seqHPL,
    challanSeqAIL,
    challanSeqHPL,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  try {
    const pmRef = doc(db, COLLECTIONS.PACKING_MASTER, 'sequences');
    await setDoc(pmRef, { seqAIL, seqHPL, challanSeqAIL, challanSeqHPL, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (err) {
    console.warn('packing_master sequence sync error:', err);
  }

  // Sync to thermocol_packing collection
  try {
    const tpRef = doc(db, COLLECTIONS.THERMOCOL_PACKING, 'sequences');
    await setDoc(tpRef, { seqAIL, seqHPL, challanSeqAIL, challanSeqHPL, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (err) {
    console.warn('thermocol_packing sequence sync error:', err);
  }
};

// =======================================================
// INDEPENDENT THERMOCOL_PACKING FIRESTORE COLLECTION SYNC
// =======================================================

export const subscribeToThermocolPackingStore = (
  callback: (storeData: {
    inwards?: ThermocolInward[];
    invoices?: ThermocolInvoice[];
    products?: ThermocolProduct[];
    parties?: ThermocolParty[];
    transporters?: ThermocolTransporter[];
    demands?: ClientDemand[];
    audits?: InvoiceAuditLog[];
    sequences?: { seqAIL: number; seqHPL: number };
  }) => void,
  onError?: (err: any) => void
) => {
  const colRef = collection(db, COLLECTIONS.THERMOCOL_PACKING);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const result: any = {};
      snapshot.forEach((docSnap) => {
        const id = docSnap.id;
        const data = docSnap.data();
        if (id === 'inwards') result.inwards = data.items || [];
        else if (id === 'invoices') result.invoices = data.items || [];
        else if (id === 'products') result.products = data.items || [];
        else if (id === 'parties') result.parties = data.items || [];
        else if (id === 'transporters') result.transporters = data.items || [];
        else if (id === 'demands') result.demands = data.items || [];
        else if (id === 'audits') result.audits = data.items || [];
        else if (id === 'sequences') result.sequences = { seqAIL: data.seqAIL || 392, seqHPL: data.seqHPL || 1 };
      });
      callback(result);
    },
    (err) => {
      console.warn('thermocol_packing collection subscription error:', err);
      if (onError) onError(err);
    }
  );
};

export const syncThermocolPackingStateToFirestore = async (payload: {
  products?: ThermocolProduct[];
  parties?: ThermocolParty[];
  transporters?: ThermocolTransporter[];
  demands?: ClientDemand[];
  inwards?: ThermocolInward[];
  invoices?: ThermocolInvoice[];
  audits?: InvoiceAuditLog[];
  seqAIL?: number;
  seqHPL?: number;
  challanSeqAIL?: number;
  challanSeqHPL?: number;
}): Promise<void> => {
  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();

    if (payload.products) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'products'), { items: payload.products, updatedAt: nowIso });
    }
    if (payload.parties) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'parties'), { items: payload.parties, updatedAt: nowIso });
    }
    if (payload.transporters) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'transporters'), { items: payload.transporters, updatedAt: nowIso });
    }
    if (payload.demands) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'demands'), { items: payload.demands, updatedAt: nowIso });
    }
    if (payload.inwards) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'inwards'), { items: payload.inwards, updatedAt: nowIso });
    }
    if (payload.invoices) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'invoices'), { items: payload.invoices, updatedAt: nowIso });
    }
    if (payload.audits) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'audits'), { items: payload.audits, updatedAt: nowIso });
    }
    if (payload.seqAIL !== undefined || payload.seqHPL !== undefined || payload.challanSeqAIL !== undefined || payload.challanSeqHPL !== undefined) {
      batch.set(doc(db, COLLECTIONS.THERMOCOL_PACKING, 'sequences'), {
        seqAIL: payload.seqAIL ?? 392,
        seqHPL: payload.seqHPL ?? 1,
        challanSeqAIL: payload.challanSeqAIL ?? 1,
        challanSeqHPL: payload.challanSeqHPL ?? 1,
        updatedAt: nowIso
      });
    }

    await batch.commit();
    console.log('[Firestore Sync] Synced packing material data to thermocol_packing collection.');
  } catch (error) {
    console.error('Error syncing to thermocol_packing collection:', error);
  }
};


