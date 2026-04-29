/**
 * Samsara Telemetry Engine
 * 
 * This module fetches real-time GPS coordinates directly from the Samsara Vehicle Stats API.
 */

const SAMSARA_CONFIG = {
  STOPS: [
    { "id": 1, "name": "Stop 01", "lat": 40.759433036950966, "lng": -73.98454271585518 },
    { "id": 2, "name": "Stop 02", "lat": 40.7551337, "lng": -73.9878992 },
    { "id": 3, "name": "Stop 03", "lat": 40.7540893569216, "lng": -73.98240036497312 },
    { "id": 4, "name": "Stop 04", "lat": 40.74948665445104, "lng": -73.98400743844203 },
    { "id": 5, "name": "Stop 05", "lat": 40.74124988195435, "lng": -73.98986219295237 },
    { "id": 6, "name": "Stop 06", "lat": 40.72274571331615, "lng": -73.99935832990472 },
    { "id": 7, "name": "Stop 07", "lat": 40.7181918, "lng": -74.00303760489153 },
    { "id": 8, "name": "Stop 08", "lat": 40.71287778281122, "lng": -74.00761735246677 },
    { "id": 9, "name": "Stop 09", "lat": 40.70485523333685, "lng": -74.0145540134917 },
    { "id": 10, "name": "Stop 10", "lat": 40.71744280723422, "lng": -74.01266527299902 },
    { "id": 11, "name": "Stop 11", "lat": 40.728250369455836, "lng": -74.01055839970415 },
    { "id": 12, "name": "Stop 12", "lat": 40.75470897188512, "lng": -74.00641577135055 },
    { "id": 13, "name": "Stop 13", "lat": 40.761713808732345, "lng": -74.0007794063889 },
    { "id": 14, "name": "Stop 14", "lat": 40.758033819326194, "lng": -73.98907964773709 },
    { "id": 15, "name": "Stop 15", "lat": 40.7601836, "lng": -73.9874334 },
    { "id": 16, "name": "Stop 16", "lat": 40.776564036598295, "lng": -73.97567436826684 },
    { "id": 17, "name": "Stop 17", "lat": 40.781254188344924, "lng": -73.972319676628 },
    { "id": 18, "name": "Stop 18", "lat": 40.79280713927449, "lng": -73.95224754745723 },
    { "id": 19, "name": "Stop 19", "lat": 40.78358504626594, "lng": -73.95898904334892 },
    { "id": 20, "name": "Stop 20", "lat": 40.779910469854684, "lng": -73.96167300597553 },
    { "id": 21, "name": "Stop 21", "lat": 40.76826722798106, "lng": -73.9701455132616 },
    { "id": 22, "name": "Stop 22", "lat": 40.765145593895625, "lng": -73.98037615495919 },
    { "id": 23, "name": "Stop 23", "lat": 40.76127825073647, "lng": -73.98318299967468 }
  ]
};

class SamsaraEngine {
  static get CONFIG() { return SAMSARA_CONFIG; }

  static async fetchBusLocation(vehicleId, accessToken) {
    try {
      const timestamp = Date.now();
      const listUrl = `https://api.samsara.com/fleet/vehicles?_cb=${timestamp}`;
      
      const listRes = await fetch(listUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
      });

      if (!listRes.ok) throw new Error(`Discovery Error: ${listRes.status}`);
      const listData = await listRes.json();
      const vehicles = listData.data || [];
      const searchId = vehicleId.trim().toLowerCase();
      
      const match = vehicles.find(v => 
        (v.name || '').trim().toLowerCase() === searchId || 
        (v.id || '').trim().toLowerCase() === searchId
      );

      if (!match) throw new Error('Bus Not Found');

      const locUrl = `https://api.samsara.com/fleet/vehicles/locations?vehicleIds=${match.id}&_cb=${timestamp}`;
      const locRes = await fetch(locUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
      });

      if (!locRes.ok) throw new Error(`Location Error: ${locRes.status}`);
      const locData = await locRes.json();
      const loc = (locData.data || [])[0];

      if (!loc || !loc.location) throw new Error('No GPS Data');

      return {
        latitude: loc.location.latitude,
        longitude: loc.location.longitude,
        heading: loc.location.heading || 0,
        speed: loc.location.speed || 0,
        time: loc.location.time,
        address: loc.location.reverseGeo ? loc.location.reverseGeo.formattedLocation : "Unknown"
      };
    } catch (e) {
      throw e;
    }
  }

  static getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  static getBearingDegrees(startLat, startLng, destLat, destLng) {
    const y = Math.sin((destLng - startLng) * Math.PI / 180) * Math.cos(destLat * Math.PI / 180);
    const x = Math.cos(startLat * Math.PI / 180) * Math.sin(destLat * Math.PI / 180) -
              Math.sin(startLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.cos((destLng - startLng) * Math.PI / 180);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  static resolveRouteContext(busGps, routeStops) {
    const stops = routeStops.map(s => ({
      ...s,
      distanceMeters: this.getDistanceMeters(busGps.latitude, busGps.longitude, s.lat, s.lng)
    })).sort((a, b) => a.distanceMeters - b.distanceMeters);

    const absoluteClosest = stops[0];
    const cluster = absoluteClosest.id <= 14 ? stops.filter(s => s.id <= 14) : stops.filter(s => s.id > 14);

    const analyzed = cluster.map(s => {
      const bearing = this.getBearingDegrees(busGps.latitude, busGps.longitude, s.lat, s.lng);
      let diff = Math.abs(busGps.heading - bearing);
      if (diff > 180) diff = 360 - diff;
      return { ...s, isBehind: diff > 90 };
    }).sort((a, b) => a.distanceMeters - b.distanceMeters);

    return {
      absoluteClosest,
      lastVisited: analyzed.find(s => s.isBehind) || null,
      upcoming: analyzed.find(s => !s.isBehind) || null
    };
  }

  static async findBusesNearStop(lat, lng, accessToken, limit = 3) {
    const timestamp = Date.now();
    const listUrl = `https://api.samsara.com/fleet/vehicles?_cb=${timestamp}`;
    const locUrl = `https://api.samsara.com/fleet/vehicles/locations?_cb=${timestamp}`;

    try {
      const listRes = await fetch(listUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
      });
      const listData = await listRes.json();
      const nameMap = {};
      (listData.data || []).forEach(v => { nameMap[v.id] = v.name; });

      const locRes = await fetch(locUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
      });
      const activeLocations = (await locRes.json()).data || [];

      return activeLocations.map(v => ({
        id: v.id,
        name: nameMap[v.id] || v.name || v.id,
        latitude: v.location.latitude,
        longitude: v.location.longitude,
        heading: v.location.heading || 0,
        distanceToStop: this.getDistanceMeters(lat, lng, v.location.latitude, v.location.longitude)
      })).filter(v => v.latitude).sort((a, b) => a.distanceToStop - b.distanceToStop).slice(0, limit);
    } catch (e) { throw e; }
  }
}

if (typeof window !== 'undefined') { window.SamsaraEngine = SamsaraEngine; }
export default SamsaraEngine;
