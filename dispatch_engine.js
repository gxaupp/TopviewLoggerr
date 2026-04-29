/**
 * DispatchEngine
 * 
 * Correlates CountIf dispatch data with Samsara telemetry.
 */
class DispatchEngine {
  /**
   * Finds the most recent operator for a specific bus from CountIf records.
   * @param {string} busId - The bus number (e.g. '4205')
   * @param {Array} dispatchRecords - Array of { bus, operator, date, ... }
   * @returns {Object|null} The most recent record for this bus
   */
  static findActiveDriver(busId, dispatchRecords) {
    if (!busId || !dispatchRecords || dispatchRecords.length === 0) {
      console.warn(`[DispatchEngine] No records to search for bus ${busId}`);
      return null;
    }

    const normalize = (id) => {
      if (!id) return '';
      // Extract the primary bus number (e.g. from "501 - TAT" -> "501")
      const match = id.toString().match(/\d+/);
      if (match) {
         // Return just the number, stripped of leading zeros
         return match[0].replace(/^0+/, '') || '0'; 
      }
      // Fallback for non-numeric IDs
      return id.toString().toLowerCase()
        .replace(/bus/gi, '')
        .replace(/[^a-z0-9]/gi, '')
        .trim();
    };
    const targetId = normalize(busId);
    
    // Filter records for this bus using normalized IDs
    const matches = dispatchRecords.filter(r => {
      if (!r.bus) return false;
      return normalize(r.bus) === targetId;
    });
    
    if (matches.length === 0) {
      console.warn(`[DispatchEngine] No match found for normalized bus ${targetId} out of ${dispatchRecords.length} records.`);
      return null;
    }

    // Sort by date descending
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log(`[DispatchEngine] Found match for bus ${targetId}: ${matches[0].operator}`);
    return matches[0];
  }

  /**
   * Enriches Samsara telemetry with Dispatch info.
   * @param {Object} busGps - Samsara telemetry
   * @param {Array} dispatchRecords - CountIf records
   * @returns {Object} Combined data
   */
  static getEnrichedStatus(busGps, busId, dispatchRecords) {
    const driverInfo = this.findActiveDriver(busId, dispatchRecords);
    
    return {
      ...busGps,
      busId: busId,
      operator: driverInfo ? driverInfo.operator : 'Unknown Driver',
      lastDispatchStop: driverInfo ? driverInfo.stop : 'N/A',
      dispatchTime: driverInfo ? driverInfo.date : null
    };
  }
}

export default DispatchEngine;
