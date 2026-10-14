import { LoadUnloadEntry, SecurityGateEntry, WaitingQueueItem } from '../types';

/**
 * Safely parses various date formats used across WMS:
 * - DD/MM/YYYY, HH:MM:SS (Indian formatted gate timestamps)
 * - DD/MM/YYYY
 * - YYYY-MM-DD (standard HTML date inputs)
 * - ISO string timestamps
 */
export function parseWmsDate(dateStr?: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // 1. Check DD/MM/YYYY format with optional time
  const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ddmmyyyyMatch) {
    const day = parseInt(ddmmyyyyMatch[1], 10);
    const month = parseInt(ddmmyyyyMatch[2], 10) - 1;
    const year = parseInt(ddmmyyyyMatch[3], 10);
    const hours = ddmmyyyyMatch[4] ? parseInt(ddmmyyyyMatch[4], 10) : 0;
    const minutes = ddmmyyyyMatch[5] ? parseInt(ddmmyyyyMatch[5], 10) : 0;
    const seconds = ddmmyyyyMatch[6] ? parseInt(ddmmyyyyMatch[6], 10) : 0;
    const d = new Date(year, month, day, hours, minutes, seconds);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. Check YYYY-MM-DD format
  const yyyymmddMatch = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (yyyymmddMatch) {
    const year = parseInt(yyyymmddMatch[1], 10);
    const month = parseInt(yyyymmddMatch[2], 10) - 1;
    const day = parseInt(yyyymmddMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // 3. Fallback standard parse
  const fallback = new Date(trimmed);
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}

/**
 * Strict purpose checkers to prevent 'unloading' matching .includes('loading')
 */
export function isUnloadingPurpose(purpose?: string): boolean {
  if (!purpose) return false;
  const p = purpose.trim().toLowerCase();
  return p === 'unloading' || p.includes('unload');
}

export function isLoadingPurpose(purpose?: string): boolean {
  if (!purpose) return false;
  const p = purpose.trim().toLowerCase();
  return (p === 'loading' || p.includes('load')) && !p.includes('unload');
}

/**
 * Checks if a log's date corresponds to today's date
 */
export function isWmsLogToday(dateTimeStr?: string, entryDateStr?: string): boolean {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayIso = `${yyyy}-${mm}-${dd}`;

  if (entryDateStr && entryDateStr.trim() === todayIso) {
    return true;
  }

  const d1 = parseWmsDate(dateTimeStr);
  if (d1 && d1.getFullYear() === today.getFullYear() && d1.getMonth() === today.getMonth() && d1.getDate() === today.getDate()) {
    return true;
  }

  const d2 = parseWmsDate(entryDateStr);
  if (d2 && d2.getFullYear() === today.getFullYear() && d2.getMonth() === today.getMonth() && d2.getDate() === today.getDate()) {
    return true;
  }

  return false;
}

/**
 * Normalizes vehicle registration strings by removing spaces, dashes, dots,
 * and converting to uppercase so "MP-09-AB-1234", "MP09AB1234", "MP 09 AB 1234" match cleanly.
 */
export function normalizeVehicleNo(v: string | undefined | null): string {
  if (!v) return '';
  return v.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

/**
 * Normalizes company / division names across WMS:
 * - 'AHPL', 'HPL', 'HEALTHCARE' -> 'AHPL'
 * - 'AIL', 'INDIA', 'LIMITED' -> 'AIL'
 */
export function normalizeCompany(c?: string | null): string {
  if (!c) return 'AIL';
  const u = c.trim().toUpperCase();
  if (u.includes('AHPL') || u.includes('HPL') || u.includes('HEALTHCARE')) return 'AHPL';
  if (u.includes('AIL') || u.includes('INDIA')) return 'AIL';
  return u || 'AIL';
}

/**
 * Extracts all distinct divisions/units associated with a security gate entry.
 * Expands multi-division values like 'BOTH', 'AIL & AHPL', 'AIL/AHPL' into ['AHPL', 'AIL'].
 */
export function getVehicleDivisions(veh: SecurityGateEntry): string[] {
  if (!veh) return ['AIL'];
  const divSet = new Set<string>();

  // 1. Check destinations first for explicit per-destination units
  if (veh.milkRouteDestinations && veh.milkRouteDestinations.length > 0) {
    veh.milkRouteDestinations.forEach((m) => {
      const u = (m.unit || '').trim().toUpperCase();
      if (u === 'BOTH' || u.includes('&') || u.includes('/') || (u.includes('AIL') && u.includes('AHPL'))) {
        divSet.add('AHPL');
        divSet.add('AIL');
      } else if (u) {
        divSet.add(normalizeCompany(u));
      }
    });
  }

  if (veh.multiDestinations && veh.multiDestinations.length > 0) {
    veh.multiDestinations.forEach((m: any) => {
      const u = (typeof m === 'object' && m?.unit) ? m.unit.trim().toUpperCase() : '';
      if (u === 'BOTH' || u.includes('&') || u.includes('/') || (u.includes('AIL') && u.includes('AHPL'))) {
        divSet.add('AHPL');
        divSet.add('AIL');
      } else if (u) {
        divSet.add(normalizeCompany(u));
      }
    });
  }

  // 2. Check main unit string
  const mainUnit = (veh.unit || '').trim().toUpperCase();
  if (mainUnit === 'BOTH' || mainUnit.includes('&') || mainUnit.includes('/') || mainUnit.includes(',') || (mainUnit.includes('AIL') && mainUnit.includes('AHPL'))) {
    divSet.add('AHPL');
    divSet.add('AIL');
  } else if (mainUnit) {
    divSet.add(normalizeCompany(mainUnit));
  }

  if (divSet.size === 0) {
    divSet.add('AIL');
  }

  return Array.from(divSet);
}

/**
 * Checks whether a specific division (e.g., 'AHPL' or 'AIL') for a gate entry has already been assigned
 * a dock or operated on in loadEntries.
 */
export function isDivisionProcessed(
  veh: SecurityGateEntry,
  division: string,
  loadEntries: LoadUnloadEntry[] = []
): boolean {
  if (!veh || !loadEntries || loadEntries.length === 0) return false;

  const vehNorm = normalizeVehicleNo(veh.vehicle);
  const targetNormDiv = normalizeCompany(division);

  return loadEntries.some((op) => {
    // Exclude cancelled/rejected operations
    const opStatusUpper = (op.status || '').trim().toUpperCase();
    if (opStatusUpper.includes('CANCEL') || opStatusUpper.includes('REJECT')) return false;

    const isGateIdMatch = Boolean(op.gateId && veh.id && op.gateId === veh.id);
    const opVehNorm = normalizeVehicleNo(op.vehicleNo);
    const isVehMatch = Boolean(vehNorm && opVehNorm && vehNorm === opVehNorm);

    if (!isGateIdMatch && !isVehMatch) return false;

    // Check division match
    const opDiv = normalizeCompany((op as any).company || op.unit);
    if (opDiv !== targetNormDiv) return false;

    // Active dock assignment or status
    const hasDock = Boolean(
      (op.bayNo && op.bayNo !== 'Unassigned' && op.bayNo.trim() !== '') ||
      (op.assignedDock && op.assignedDock !== 'Unassigned' && op.assignedDock.trim() !== '')
    );

    return hasDock || opStatusUpper.length > 0;
  });
}

/**
 * Evaluates whether a gate security entry (or a specific division within it) is strictly still pending / waiting.
 * If targetDivision is provided, returns true if THAT division is still waiting.
 * If targetDivision is omitted, returns true if AT LEAST ONE division is still waiting.
 */
export function isPendingGateEntry(
  veh: SecurityGateEntry,
  loadEntries: LoadUnloadEntry[] = [],
  targetDivision?: string
): boolean {
  if (!veh) return false;
  if (veh.purpose === 'Parking / Transit') return false;

  const nonWaitingStatuses = [
    'COMPLETED',
    'CLOSED',
    'LOADED',
    'UNLOADED',
    'EXITED',
    'DISPATCHED',
    'CANCELLED',
    'REJECTED',
    'OUT',
    'GATE OUT',
    'FINISHED',
    'FINISH',
    'DONE',
    'RESOLVED',
    'ARCHIVED'
  ];

  const statusUpper = (veh.status || '').trim().toUpperCase();
  if (nonWaitingStatuses.some(st => statusUpper.includes(st))) return false;
  if ((veh as any).completed === true) return false;

  // Skip if exit time has been logged in any format
  if (veh.loadingExitTime && veh.loadingExitTime.trim() !== '') return false;
  if ((veh as any).exitTime && (veh as any).exitTime.trim() !== '') return false;
  if ((veh as any).gateOutTime && (veh as any).gateOutTime.trim() !== '') return false;
  if ((veh as any).exitDateTime && (veh as any).exitDateTime.trim() !== '') return false;
  if ((veh as any).outTime && (veh as any).outTime.trim() !== '') return false;

  if (targetDivision) {
    return !isDivisionProcessed(veh, targetDivision, loadEntries);
  }

  const divisions = getVehicleDivisions(veh);
  return divisions.some((div) => !isDivisionProcessed(veh, div, loadEntries));
}

/**
 * Resolves the actual target location / destination for a gate entry,
 * preventing generic 'Warehouse' from masking the real location in the waiting queue.
 */
export function resolveQueueActualLocation(veh: SecurityGateEntry, isUnloadVeh: boolean): string {
  // 1. Check explicit target_location or destination
  const explicit = (veh.target_location || (veh as any).destination || (veh as any).targetLocation || (veh as any).location || '')?.trim();
  if (explicit && explicit.toUpperCase() !== 'WAREHOUSE' && explicit.toUpperCase() !== 'UNASSIGNED') {
    return explicit;
  }

  const fromTrim = (veh.fromLoc || '').trim();
  const toTrim = (veh.toLoc || '').trim();

  const isFromValid = fromTrim && fromTrim.toUpperCase() !== 'WAREHOUSE' && fromTrim.toUpperCase() !== 'UNASSIGNED';
  const isToValid = toTrim && toTrim.toUpperCase() !== 'WAREHOUSE' && toTrim.toUpperCase() !== 'UNASSIGNED';

  if (isUnloadVeh) {
    if (isFromValid) return fromTrim;
    if (isToValid) return toTrim;
  } else {
    if (isToValid) return toTrim;
    if (isFromValid) return fromTrim;
  }

  if (explicit) return explicit;
  if (fromTrim && fromTrim.toUpperCase() !== 'WAREHOUSE') return fromTrim;
  if (toTrim && toTrim.toUpperCase() !== 'WAREHOUSE') return toTrim;

  return 'INDORE HUB';
}

/**
 * Centralized, authoritative calculation of active items in the Waiting Queue.
 * Synchronizes gate arrivals with active and completed dock operations per company division.
 * Supports composite division-level queue keys (e.g. vehicle + division: AIL / AHPL),
 * ensuring that when one division is processed, remaining unprocessed divisions for the
 * same vehicle remain active in the queue.
 */
export function computeWaitingQueueItems(
  securityLogs: SecurityGateEntry[],
  loadEntries: LoadUnloadEntry[],
  dismissedQueueKeys?: Set<string>
): WaitingQueueItem[] {
  const items: WaitingQueueItem[] = [];

  securityLogs.forEach((veh) => {
    if (veh.purpose === 'Parking / Transit') return;

    // Get all divisions carried by this vehicle arrival
    const divisions = getVehicleDivisions(veh);

    divisions.forEach((div) => {
      // 1. Check if this specific division is pending/unprocessed
      if (!isPendingGateEntry(veh, loadEntries, div)) return;

      // 2. Composite Queue Key per vehicle + division (e.g. "GATE123_AHPL", "GATE123_AIL")
      const compositeKey = `${veh.id}_${div}`;
      if (dismissedQueueKeys && (dismissedQueueKeys.has(compositeKey) || dismissedQueueKeys.has(veh.id))) return;

      const isUnloadVeh = isUnloadingPurpose(veh.purpose);
      const authoritativePurpose: 'Loading' | 'Unloading' = isUnloadVeh ? 'Unloading' : 'Loading';

      // Build target locations / destinations for this specific division
      const targets: { location: string; unit: string }[] = [];

      const hasMultipleDestinations = 
        (veh.milkRouteDestinations && veh.milkRouteDestinations.length > 0) ||
        (veh.multiDestinations && veh.multiDestinations.length > 0);

      if (hasMultipleDestinations) {
        if (veh.milkRouteDestinations && veh.milkRouteDestinations.length > 0) {
          veh.milkRouteDestinations.forEach((m) => {
            const loc = m.location?.trim();
            if (!loc) return;
            const u = m.unit?.trim().toUpperCase() || veh.unit?.trim().toUpperCase() || 'AHPL';
            if (u === 'BOTH' || normalizeCompany(u) === div) {
              targets.push({ location: loc, unit: div });
            }
          });
        } else if (veh.multiDestinations && veh.multiDestinations.length > 0) {
          veh.multiDestinations.forEach((m: any) => {
            const loc = typeof m === 'string' ? m.trim() : m?.location?.trim();
            if (!loc) return;
            const u = (typeof m === 'object' && m?.unit) ? m.unit.trim().toUpperCase() : (veh.unit?.trim().toUpperCase() || 'AHPL');
            if (u === 'BOTH' || normalizeCompany(u) === div) {
              targets.push({ location: loc, unit: div });
            }
          });
        }
      }

      if (targets.length === 0) {
        const rawLoc = resolveQueueActualLocation(veh, isUnloadVeh);
        const splitLocs = rawLoc.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
        const locList = splitLocs.length > 0 ? splitLocs : [rawLoc.trim() || 'INDORE HUB'];
        locList.forEach((loc) => {
          targets.push({ location: loc, unit: div });
        });
      }

      // Deduplicate targets for this division queue item
      const uniqueTargets: { location: string; unit: string }[] = [];
      targets.forEach((t) => {
        if (!uniqueTargets.some((u) => u.location.toLowerCase() === t.location.toLowerCase() && u.unit === t.unit)) {
          uniqueTargets.push(t);
        }
      });

      const isToday = isWmsLogToday(veh.dateTime, veh.entryDate);
      const isCarriedForward = veh.isCarriedForward || !isToday;

      const resolvedLocation = uniqueTargets[0]?.location || resolveQueueActualLocation(veh, isUnloadVeh);

      items.push({
        queueKey: compositeKey,
        gateId: veh.id,
        entryDate: veh.entryDate || (veh.dateTime ? veh.dateTime.substring(0, 10) : new Date().toISOString().split('T')[0]),
        vehicle: veh.vehicle,
        vType: veh.vType || '32FT MXL',
        mobile: veh.mobile || 'N/A',
        transporter: veh.transporter || 'N/A',
        purpose: authoritativePurpose,
        unit: div,
        location: resolvedLocation,
        target_location: resolvedLocation,
        dateTime: veh.dateTime || '',
        remarks: veh.remarks || veh.supervisorNameRemarks,
        grNo: veh.grNo,
        routeType: veh.routeType || 'Single Drop',
        isSplit: uniqueTargets.length > 1,
        totalLocationsInEntry: uniqueTargets.length,
        originalGateEntry: veh,
        allTargets: uniqueTargets.length > 0 ? uniqueTargets : [{ location: resolvedLocation, unit: div }],
        isCarriedForward,
        status: veh.status || (isCarriedForward ? 'Rollover Pending' : 'Waiting'),
        completed: false,
      });
    });
  });

  return items;
}

export function getGateTargetLocations(veh: SecurityGateEntry): { location: string; unit: string }[] {
  const targets: { location: string; unit: string }[] = [];
  const defaultUnit = veh.unit?.trim().toUpperCase() || 'AHPL';

  const hasMultipleDestinations = 
    (veh.milkRouteDestinations && veh.milkRouteDestinations.length > 0) ||
    (veh.multiDestinations && veh.multiDestinations.length > 0);

  if (hasMultipleDestinations) {
    if (veh.milkRouteDestinations && veh.milkRouteDestinations.length > 0) {
      veh.milkRouteDestinations.forEach((m) => {
        const loc = m.location?.trim();
        if (!loc) return;
        const u = m.unit?.trim().toUpperCase() || defaultUnit;
        if (u === 'BOTH') {
          targets.push({ location: loc, unit: 'AHPL' });
          targets.push({ location: loc, unit: 'AIL' });
        } else {
          targets.push({ location: loc, unit: u });
        }
      });
    } else if (veh.multiDestinations && veh.multiDestinations.length > 0) {
      veh.multiDestinations.forEach((m: any) => {
        const loc = typeof m === 'string' ? m.trim() : m?.location?.trim();
        if (!loc) return;
        const u = (typeof m === 'object' && m?.unit) ? m.unit.trim().toUpperCase() : defaultUnit;
        targets.push({ location: loc, unit: u });
      });
    }
  } else {
    const rawLoc = veh.destination || veh.toLoc || veh.fromLoc || 'INDORE HUB';
    if (rawLoc.includes('/') || rawLoc.includes(',')) {
      const parts = rawLoc.split(/[/,]/).map(s => s.trim()).filter(Boolean);
      parts.forEach((p) => {
        let cleanLoc = p;
        let stopUnit = defaultUnit === 'BOTH' ? 'AHPL' : defaultUnit;
        const matchUnit = p.match(/\[(.*?)\]|\((.*?)\)/);
        if (matchUnit) {
          const uStr = (matchUnit[1] || matchUnit[2] || '').trim().toUpperCase();
          if (uStr === 'AHPL' || uStr === 'AIL') stopUnit = uStr;
          cleanLoc = p.replace(/\[.*?\]|\(.*?\)/g, '').trim();
        }
        if (cleanLoc) {
          targets.push({ location: cleanLoc, unit: stopUnit });
        }
      });
    }
    if (targets.length === 0) {
      targets.push({ location: rawLoc, unit: defaultUnit === 'BOTH' ? 'AHPL' : defaultUnit });
    }
  }

  return targets;
}


