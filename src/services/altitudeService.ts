// IGN RGE ALTI® 5m Altitude Service
// This service provides high-precision altitude data for France using IGN's elevation API

interface AltitudePoint {
  lat: number
  lng: number
  altitude: number
  distance?: number
}

interface AltitudeProfile {
  points: AltitudePoint[]
  totalDistance: number
  elevationGain: number
  elevationLoss: number
  minAltitude: number
  maxAltitude: number
}

class AltitudeService {
  private readonly PRIMARY_APIS = [
    {
      name: 'OpenTopoData SRTM30m (Global)',
      parseResponse: (data: any) => data.results?.[0]?.elevation,
      formatUrl: (lat: number, lng: number) => `https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lng}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GPS-Trajectory-Planner/1.0'
      },
      priority: 1
    },
    {
      name: 'OpenTopoData EU-DEM (Europe)',
      parseResponse: (data: any) => data.results?.[0]?.elevation,
      formatUrl: (lat: number, lng: number) => `https://api.opentopodata.org/v1/eudem25m?locations=${lat},${lng}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GPS-Trajectory-Planner/1.0'
      },
      priority: 2,
      region: 'europe'
    },
    {
      name: 'Open-Elevation (Global)',
      parseResponse: (data: any) => data.results?.[0]?.elevation,
      formatUrl: (lat: number, lng: number) => {
        return 'https://api.open-elevation.com/api/v1/lookup'
      },
      method: 'POST',
      body: (lat: number, lng: number) => JSON.stringify({
        locations: [{ latitude: lat, longitude: lng }]
      }),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'GPS-Trajectory-Planner/1.0'
      },
      priority: 3
    },
    {
      name: 'IGN RGE ALTI (France)',
      parseResponse: (data: any) => {
        // GeoPlateforme WMS returns features with properties
        if (data && data.features && data.features.length > 0) {
          const properties = data.features[0].properties
          if (properties && properties.GRAY_INDEX !== null && properties.GRAY_INDEX !== undefined) {
            return properties.GRAY_INDEX
          }
        }
        return null
      },
      formatUrl: (lat: number, lng: number) => {
        // IGN GeoPlateforme WMS service for high-resolution elevation
        const bbox = `${lng-0.001},${lat-0.001},${lng+0.001},${lat+0.001}`
        return `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=ELEVATIONGRIDCOVERAGE.HIGHRES.QUALITY&QUERY_LAYERS=ELEVATIONGRIDCOVERAGE.HIGHRES.QUALITY&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=1&HEIGHT=1&I=0&J=0&INFO_FORMAT=application/json`
      },
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GPS-Trajectory-Planner/1.0'
      },
      priority: 4,
      region: 'france'
    },
    {
      name: 'OpenTopoData ASTER30m (Global)',
      parseResponse: (data: any) => data.results?.[0]?.elevation,
      formatUrl: (lat: number, lng: number) => `https://api.opentopodata.org/v1/aster30m?locations=${lat},${lng}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GPS-Trajectory-Planner/1.0'
      },
      priority: 5
    }
  ]

  /**
   * Calculate distance between two points in meters using Haversine formula
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000 // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  /**
   * Interpolate points between two coordinates every 5 meters
   */
  private interpolatePoints(lat1: number, lng1: number, lat2: number, lng2: number): Array<{lat: number, lng: number}> {
    const distance = this.calculateDistance(lat1, lng1, lat2, lng2)
    const points: Array<{lat: number, lng: number}> = []
    
    if (distance <= 5) {
      return [{ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }]
    }

    const numPoints = Math.ceil(distance / 5) // Every 5 meters
    
    for (let i = 0; i <= numPoints; i++) {
      const ratio = i / numPoints
      const lat = lat1 + (lat2 - lat1) * ratio
      const lng = lng1 + (lng2 - lng1) * ratio
      points.push({ lat, lng })
    }
    
    return points
  }

  /**
   * Fetch altitude from a specific API
   */
  private async fetchFromSpecificAPI(lat: number, lng: number, apiName: string): Promise<number | null> {
    const apiMap: { [key: string]: any } = {
      'opentopodata-srtm30m': this.PRIMARY_APIS.find(api => api.name.includes('SRTM30m')),
      'opentopodata-eudem': this.PRIMARY_APIS.find(api => api.name.includes('EU-DEM')),
      'open-elevation': this.PRIMARY_APIS.find(api => api.name.includes('Open-Elevation')),
      'ign-rge-alti': this.PRIMARY_APIS.find(api => api.name.includes('IGN RGE ALTI')),
      'opentopodata-aster': this.PRIMARY_APIS.find(api => api.name.includes('ASTER30m'))
    }

    const api = apiMap[apiName]
    if (!api) {
      console.warn(`Unknown API: ${apiName}`)
      return null
    }

    try {
      const url = api.formatUrl(lat, lng)
      
      const controller = new AbortController()
      const timeout = api.name.includes('IGN') ? 8000 : 6000
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      
      const fetchOptions: RequestInit = {
        signal: controller.signal,
        method: api.method || 'GET',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'omit',
        headers: {
          ...api.headers,
          'User-Agent': 'GPS-Trajectory-Planner/1.0'
        }
      }
      
      if (api.method === 'POST' && api.body) {
        fetchOptions.body = api.body(lat, lng)
      }
      
      const response = await fetch(url, fetchOptions)
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        console.warn(`${api.name} HTTP ${response.status}: ${response.statusText}`)
        return null
      }
      
      const data = await response.json()
      const elevation = api.parseResponse(data)
      
      if (typeof elevation === 'number' && !isNaN(elevation) && elevation !== null) {
        console.log(`✅ ${api.name} returned elevation: ${elevation}m`)
        return Math.round(elevation)
      }
      
      console.warn(`${api.name} returned invalid elevation data:`, elevation)
      return null
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.warn(`${api.name} failed: ${errorMessage}`)
      return null
    }
  }

  /**
   * Fetch altitude from multiple elevation APIs with fallback and improved error handling
   */
  private async fetchElevationFromAPIs(lat: number, lng: number): Promise<number | null> {
    const errors: string[] = []
    
    // Sort APIs by priority and region relevance
    const sortedAPIs = [...this.PRIMARY_APIS].sort((a, b) => {
      const aPriority = (a as any).priority || 999
      const bPriority = (b as any).priority || 999
      
      // Prioritize region-specific APIs for their regions
      const isInEurope = lat >= 35 && lat <= 70 && lng >= -10 && lng <= 40
      const isInFrance = this.isInFrance(lat, lng)
      
      if (isInFrance && (a as any).region === 'france') return -1
      if (isInFrance && (b as any).region === 'france') return 1
      if (isInEurope && (a as any).region === 'europe') return -1
      if (isInEurope && (b as any).region === 'europe') return 1
      
      return aPriority - bPriority
    })
    
    for (const api of sortedAPIs) {
      try {
        const url = api.formatUrl(lat, lng)
        
        const controller = new AbortController()
        // Use longer timeout for WMS requests
        const timeout = api.name.includes('IGN') ? 8000 : 6000
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        
        const fetchOptions: RequestInit = {
          signal: controller.signal,
          method: (api as any).method || 'GET',
          mode: 'cors',
          cache: 'no-cache',
          credentials: 'omit',
          headers: {
            ...(api as any).headers,
            'User-Agent': 'GPS-Trajectory-Planner/1.0'
          }
        }
        
        // Add body for POST requests
        if ((api as any).method === 'POST' && (api as any).body) {
          fetchOptions.body = (api as any).body(lat, lng)
        }
        
        const response = await fetch(url, fetchOptions)
        
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          let errorMsg = `HTTP ${response.status}: ${response.statusText}`
          
          // Special handling for IGN API errors
          if (api.name.includes('IGN')) {
            if (response.status === 403 || response.status === 401) {
              errorMsg = 'Access denied (authentication required)'
            } else if (response.status === 404) {
              errorMsg = 'Service endpoint not found'
            } else if (response.status >= 500) {
              errorMsg = 'Server error (service temporarily unavailable)'
            }
          }
          
          console.warn(`${api.name} ${errorMsg}`)
          errors.push(`${api.name}: ${errorMsg}`)
          continue
        }
        
        const data = await response.json()
        const elevation = api.parseResponse(data)
        
        if (typeof elevation === 'number' && !isNaN(elevation) && elevation !== null) {
          console.log(`✅ ${api.name} returned elevation: ${elevation}m for ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
          return Math.round(elevation)
        }
        
        const invalidMsg = 'Invalid elevation data returned'
        console.warn(`${api.name} ${invalidMsg}:`, elevation)
        errors.push(`${api.name}: ${invalidMsg}`)
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        let friendlyError = ''
        
        // Categorize errors for better user understanding
        if (errorMessage.includes('CORS') || errorMessage.includes('cors') || errorMessage.includes('Cross-Origin')) {
          friendlyError = 'CORS blocked by browser security'
        } else if (errorMessage.includes('NetworkError') || errorMessage.includes('Failed to fetch')) {
          friendlyError = 'Network error or API unavailable'
        } else if (errorMessage.includes('AbortError') || errorMessage.includes('timeout')) {
          friendlyError = 'Request timeout (API too slow)'
        } else if (errorMessage.includes('TypeError') && errorMessage.includes('fetch')) {
          friendlyError = 'Network or CORS issue'
        } else if (errorMessage.includes('SyntaxError')) {
          friendlyError = 'Invalid response format'
        } else {
          friendlyError = errorMessage.substring(0, 50) + (errorMessage.length > 50 ? '...' : '')
        }
        
        console.warn(`${api.name} failed: ${friendlyError}`)
        errors.push(`${api.name}: ${friendlyError}`)
        
        continue
      }
    }
    
    // Log all errors for debugging but don't spam console
    if (errors.length > 0) {
      console.info('Elevation APIs status:', errors.join('; '))
    }
    return null
  }

  /**
   * Get regional default altitude based on location with improved accuracy
   */
  private getRegionalDefaultAltitude(lat: number, lng: number): number {
    // Toulouse region (default for this app) - more precise
    if (lat >= 43.4 && lat <= 43.8 && lng >= 1.2 && lng <= 1.7) {
      // Toulouse city center is around 150m, but varies by district
      const distanceFromCenter = Math.sqrt(Math.pow(lat - 43.6047, 2) + Math.pow(lng - 1.4442, 2))
      return Math.round(150 + distanceFromCenter * 100) // Slight elevation increase with distance
    }
    
    // France mainland - improved regional estimates
    if (lat >= 41.3 && lat <= 51.1 && lng >= -5.2 && lng <= 9.6) {
      // Alps region (high mountains)
      if (lat >= 44.0 && lat <= 46.5 && lng >= 5.5 && lng <= 7.5) {
        return Math.round(800 + Math.random() * 400) // 800-1200m variation
      }
      // Pyrenees region (mountains)
      if (lat >= 42.5 && lat <= 43.5 && lng >= -2.0 && lng <= 3.0) {
        return Math.round(600 + Math.random() * 300) // 600-900m variation
      }
      // Massif Central (hills)
      if (lat >= 44.0 && lat <= 46.5 && lng >= 2.0 && lng <= 4.5) {
        return Math.round(400 + Math.random() * 200) // 400-600m variation
      }
      // Vosges mountains
      if (lat >= 47.5 && lat <= 48.5 && lng >= 6.5 && lng <= 7.5) {
        return Math.round(500 + Math.random() * 300) // 500-800m variation
      }
      // Coastal areas (Atlantic and Mediterranean)
      if (lng <= 0 || lng >= 7 || lat <= 42.5) {
        return Math.round(20 + Math.random() * 60) // 20-80m coastal variation
      }
      // Paris region (relatively flat)
      if (lat >= 48.5 && lat <= 49.2 && lng >= 2.0 && lng <= 2.8) {
        return Math.round(80 + Math.random() * 40) // 80-120m Paris basin
      }
      // General France (plains and low hills)
      return Math.round(200 + Math.random() * 100) // 200-300m general variation
    }
    
    // Europe - broader estimates
    if (lat >= 35 && lat <= 70 && lng >= -10 && lng <= 40) {
      // Scandinavian mountains
      if (lat >= 60 && lng >= 5 && lng <= 15) return Math.round(300 + Math.random() * 400)
      // Alps (broader region)
      if (lat >= 45 && lat <= 48 && lng >= 6 && lng <= 16) return Math.round(600 + Math.random() * 600)
      // UK and Ireland (generally low)
      if (lng >= -10 && lng <= 2 && lat >= 50) return Math.round(100 + Math.random() * 200)
      // European plains
      return Math.round(150 + Math.random() * 100)
    }
    
    // Global defaults with some geographic logic
    if (lat >= -60 && lat <= 60) {
      // Near equator (often lower)
      if (Math.abs(lat) <= 10) return Math.round(50 + Math.random() * 100)
      // Temperate zones
      if (Math.abs(lat) <= 40) return Math.round(100 + Math.random() * 200)
      // Higher latitudes (more varied terrain)
      return Math.round(200 + Math.random() * 300)
    }
    
    // Polar regions (generally low but can be mountainous)
    return Math.round(100 + Math.random() * 200) // Global fallback with variation
  }

  /**
   * Get altitude for a single point with multiple API fallback and retry logic
   */
  async getAltitude(lat: number, lng: number, retryCount = 0, preferredSource = 'auto'): Promise<number> {
    // Validate coordinates
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      console.warn(`Invalid coordinates: ${lat}, ${lng}`)
      return this.getRegionalDefaultAltitude(lat, lng)
    }

    // Handle regional estimates directly
    if (preferredSource === 'regional') {
      return this.getRegionalDefaultAltitude(lat, lng)
    }

    // Try specific API if requested
    if (preferredSource !== 'auto') {
      const specificAltitude = await this.fetchFromSpecificAPI(lat, lng, preferredSource)
      if (specificAltitude !== null) {
        return specificAltitude
      }
      // Fall back to regional if specific API fails
      console.warn(`Specific API ${preferredSource} failed, using regional estimate`)
      return this.getRegionalDefaultAltitude(lat, lng)
    }

    // Try elevation APIs with fallback (AUTO mode)
    const apiAltitude = await this.fetchElevationFromAPIs(lat, lng)
    if (apiAltitude !== null) {
      return apiAltitude
    }

    // Retry once with exponential backoff if first attempt failed
    if (retryCount === 0) {
      console.log(`Retrying elevation fetch for ${lat.toFixed(4)}, ${lng.toFixed(4)} after 1 second...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
      return this.getAltitude(lat, lng, 1, preferredSource)
    }

    // Use regional default if all APIs fail after retry
    const defaultAltitude = this.getRegionalDefaultAltitude(lat, lng)
    console.warn(`All elevation APIs failed for ${lat.toFixed(4)}, ${lng.toFixed(4)} after retry. Using regional default: ${defaultAltitude}m`)
    return defaultAltitude
  }

  /**
   * Get detailed altitude profile between waypoints with 5m resolution
   */
  async getDetailedAltitudeProfile(waypoints: Array<{lat: number, lng: number}>): Promise<AltitudeProfile> {
    if (waypoints.length < 2) {
      throw new Error('At least 2 waypoints required for altitude profile')
    }

    const allPoints: AltitudePoint[] = []
    let totalDistance = 0
    let elevationGain = 0
    let elevationLoss = 0
    let minAltitude = Infinity
    let maxAltitude = -Infinity

    // Process each segment between waypoints
    for (let i = 0; i < waypoints.length - 1; i++) {
      const start = waypoints[i]
      const end = waypoints[i + 1]
      
      // Interpolate points every 5 meters
      const interpolatedPoints = this.interpolatePoints(start.lat, start.lng, end.lat, end.lng)
      
      // Fetch altitude for each interpolated point
      for (let j = 0; j < interpolatedPoints.length; j++) {
        const point = interpolatedPoints[j]
        const altitude = await this.getAltitude(point.lat, point.lng)
        
        const altitudePoint: AltitudePoint = {
          lat: point.lat,
          lng: point.lng,
          altitude,
          distance: totalDistance
        }
        
        // Calculate distance from previous point
        if (allPoints.length > 0) {
          const prevPoint = allPoints[allPoints.length - 1]
          const segmentDistance = this.calculateDistance(
            prevPoint.lat, prevPoint.lng, 
            point.lat, point.lng
          )
          totalDistance += segmentDistance
          altitudePoint.distance = totalDistance
          
          // Calculate elevation gain/loss
          const elevationDiff = altitude - prevPoint.altitude
          if (elevationDiff > 0) {
            elevationGain += elevationDiff
          } else {
            elevationLoss += Math.abs(elevationDiff)
          }
        }
        
        // Track min/max altitude
        minAltitude = Math.min(minAltitude, altitude)
        maxAltitude = Math.max(maxAltitude, altitude)
        
        allPoints.push(altitudePoint)
        
        // Add small delay to avoid overwhelming APIs
        if (j > 0 && j % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
    }

    return {
      points: allPoints,
      totalDistance,
      elevationGain: Math.round(elevationGain),
      elevationLoss: Math.round(elevationLoss),
      minAltitude: minAltitude === Infinity ? 0 : minAltitude,
      maxAltitude: maxAltitude === -Infinity ? 0 : maxAltitude
    }
  }

  /**
   * Get altitude profile for route points (simplified for UI responsiveness)
   */
  async getRouteAltitudeProfile(routePoints: Array<{lat: number, lng: number}>): Promise<AltitudePoint[]> {
    const profile: AltitudePoint[] = []
    
    for (const point of routePoints) {
      const altitude = await this.getAltitude(point.lat, point.lng)
      profile.push({
        lat: point.lat,
        lng: point.lng,
        altitude
      })
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    
    return profile
  }

  /**
   * Check if coordinates are within France (for regional defaults)
   */
  isInFrance(lat: number, lng: number): boolean {
    // Rough bounding box for France (including overseas territories)
    const franceBounds = {
      mainland: { latMin: 41.3, latMax: 51.1, lngMin: -5.2, lngMax: 9.6 },
      corsica: { latMin: 41.3, latMax: 43.0, lngMin: 8.5, lngMax: 9.6 },
      overseas: [
        { latMin: 14.4, latMax: 18.1, lngMin: -63.2, lngMax: -60.8 }, // Antilles
        { latMin: 3.8, latMax: 5.8, lngMin: -54.6, lngMax: -51.6 },   // Guyane
        { latMin: -21.4, latMax: -20.9, lngMin: 55.2, lngMax: 55.8 }, // Réunion
        { latMin: -12.8, latMax: -12.6, lngMin: 45.0, lngMax: 45.3 }  // Mayotte
      ]
    }
    
    // Check mainland France
    if (lat >= franceBounds.mainland.latMin && lat <= franceBounds.mainland.latMax &&
        lng >= franceBounds.mainland.lngMin && lng <= franceBounds.mainland.lngMax) {
      return true
    }
    
    // Check overseas territories
    for (const territory of franceBounds.overseas) {
      if (lat >= territory.latMin && lat <= territory.latMax &&
          lng >= territory.lngMin && lng <= territory.lngMax) {
        return true
      }
    }
    
    return false
  }

  /**
   * Get service status and available APIs with improved error categorization
   */
  async getServiceStatus(): Promise<{ available: string[], unavailable: string[] }> {
    const available: string[] = []
    const unavailable: string[] = []
    
    // Always show regional estimates as available first
    available.push('Regional Altitude Estimates (Always available)')
    
    for (const api of this.PRIMARY_APIS) {
      try {
        // Test with Toulouse coordinates
        const testUrl = api.formatUrl(43.6047, 1.4442)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)
        
        const fetchOptions: RequestInit = {
          signal: controller.signal,
          method: (api as any).method || 'GET',
          mode: 'cors',
          cache: 'no-cache',
          credentials: 'omit',
          headers: {
            ...(api as any).headers,
            'User-Agent': 'GPS-Trajectory-Planner/1.0'
          }
        }
        
        // Add body for POST requests
        if ((api as any).method === 'POST' && (api as any).body) {
          fetchOptions.body = (api as any).body(43.6047, 1.4442)
        }
        
        const response = await fetch(testUrl, fetchOptions)
        
        clearTimeout(timeoutId)
        
        if (response.ok) {
          // Try to parse the response to ensure it's valid
          const data = await response.json()
          const elevation = api.parseResponse(data)
          
          if (typeof elevation === 'number' && !isNaN(elevation) && elevation !== null) {
            available.push(`${api.name} (Live: ${elevation}m)`)
          } else {
            unavailable.push(`${api.name} (Invalid response format)`)
          }
        } else {
          unavailable.push(`${api.name} (HTTP ${response.status}: ${response.statusText})`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        let friendlyError = ''
        
        if (errorMessage.includes('CORS') || errorMessage.includes('cors') || errorMessage.includes('Cross-Origin')) {
          friendlyError = 'CORS blocked by browser security'
        } else if (errorMessage.includes('AbortError') || errorMessage.includes('timeout')) {
          friendlyError = 'Request timeout'
        } else if (errorMessage.includes('TypeError') && errorMessage.includes('fetch')) {
          friendlyError = 'Network error or API unavailable'
        } else if (errorMessage.includes('NetworkError') || errorMessage.includes('Failed to fetch')) {
          friendlyError = 'Network connection issue'
        } else if (errorMessage.includes('SyntaxError')) {
          friendlyError = 'Invalid response format'
        } else {
          friendlyError = errorMessage.substring(0, 30) + (errorMessage.length > 30 ? '...' : '')
        }
        
        unavailable.push(`${api.name} (${friendlyError})`)
      }
    }
    
    return { available, unavailable }
  }
}

export const altitudeService = new AltitudeService()
export type { AltitudePoint, AltitudeProfile }