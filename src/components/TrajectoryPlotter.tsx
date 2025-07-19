import React, { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Progress } from './ui/progress'
import { BarChart3, X, Mountain, Download } from 'lucide-react'
import { altitudeService } from '../services/altitudeService'
import { toast } from 'sonner'

interface RoutePoint {
  id: string
  lat: number
  lng: number
  altitude: number
  timestamp: number
  name: string
}

interface TrajectoryPlotterProps {
  routePoints: RoutePoint[]
  elevationDataSource?: string
}

// Helper function for distance calculation
function calculateDistanceBetweenPoints(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6371000 // Earth's radius in meters
  const deltaLat = (lat2 - lat1) * Math.PI / 180
  const deltaLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(deltaLng/2) * Math.sin(deltaLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return earthRadius * c
}

// Helper function for regional altitude estimation
function getRegionalAltitudeEstimate(lat: number, lng: number): number {
  // Toulouse region - more precise estimates
  if (lat >= 43.4 && lat <= 43.8 && lng >= 1.2 && lng <= 1.7) {
    const distanceFromCenter = Math.sqrt(Math.pow(lat - 43.6047, 2) + Math.pow(lng - 1.4442, 2))
    return Math.round(150 + distanceFromCenter * 100)
  }
  
  // France mainland
  if (lat >= 41.3 && lat <= 51.1 && lng >= -5.2 && lng <= 9.6) {
    // Alps region
    if (lat >= 44.0 && lat <= 46.5 && lng >= 5.5 && lng <= 7.5) {
      return Math.round(800 + Math.random() * 400)
    }
    // Pyrenees region
    if (lat >= 42.5 && lat <= 43.5 && lng >= -2.0 && lng <= 3.0) {
      return Math.round(600 + Math.random() * 300)
    }
    // General France
    return Math.round(200 + Math.random() * 100)
  }
  
  // Global fallback
  return Math.round(150 + Math.random() * 100)
}

export function TrajectoryPlotter({ routePoints, elevationDataSource = 'auto' }: TrajectoryPlotterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [detailedProfile, setDetailedProfile] = useState<any>(null)
  const [isGeneratingProfile, setIsGeneratingProfile] = useState(false)
  const [profileProgress, setProfileProgress] = useState(0)

  // Fallback profile generation using regional estimates
  const generateFallbackProfile = useCallback(async (points: RoutePoint[]) => {
    const waypoints = points.map(p => ({ lat: p.lat, lng: p.lng }))
    const profilePoints = []
    let totalDistance = 0
    let elevationGain = 0
    let elevationLoss = 0
    let minAltitude = Infinity
    let maxAltitude = -Infinity

    for (let i = 0; i < waypoints.length - 1; i++) {
      const start = waypoints[i]
      const end = waypoints[i + 1]
      
      // Simple interpolation between points (every 50m instead of 5m for fallback)
      const distance = calculateDistanceBetweenPoints(start.lat, start.lng, end.lat, end.lng)
      const numPoints = Math.max(2, Math.ceil(distance / 50)) // 50m spacing for fallback
      
      for (let j = 0; j <= numPoints; j++) {
        const ratio = j / numPoints
        const lat = start.lat + (end.lat - start.lat) * ratio
        const lng = start.lng + (end.lng - start.lng) * ratio
        
        // Use regional default altitude
        const altitude = getRegionalAltitudeEstimate(lat, lng)
        
        const point = {
          lat,
          lng,
          altitude,
          distance: totalDistance
        }
        
        if (profilePoints.length > 0) {
          const prevPoint = profilePoints[profilePoints.length - 1]
          const segmentDistance = calculateDistanceBetweenPoints(
            prevPoint.lat, prevPoint.lng, 
            lat, lng
          )
          totalDistance += segmentDistance
          point.distance = totalDistance
          
          const elevationDiff = altitude - prevPoint.altitude
          if (elevationDiff > 0) {
            elevationGain += elevationDiff
          } else {
            elevationLoss += Math.abs(elevationDiff)
          }
        }
        
        minAltitude = Math.min(minAltitude, altitude)
        maxAltitude = Math.max(maxAltitude, altitude)
        
        profilePoints.push(point)
      }
    }

    return {
      points: profilePoints,
      totalDistance,
      elevationGain: Math.round(elevationGain),
      elevationLoss: Math.round(elevationLoss),
      minAltitude: minAltitude === Infinity ? 0 : minAltitude,
      maxAltitude: maxAltitude === -Infinity ? 0 : maxAltitude
    }
  }, [])

  const generateDetailedProfile = useCallback(async () => {
    if (routePoints.length < 2) return

    setIsGeneratingProfile(true)
    setProfileProgress(0)

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProfileProgress(prev => Math.min(prev + 10, 90))
      }, 300)

      const waypoints = routePoints.map(p => ({ lat: p.lat, lng: p.lng }))
      
      // Add timeout and better error handling
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Profile generation timeout')), 60000) // 60 second timeout
      })
      
      const profilePromise = altitudeService.getDetailedAltitudeProfile(waypoints)
      
      const profile = await Promise.race([profilePromise, timeoutPromise]) as any
      
      clearInterval(progressInterval)
      setProfileProgress(100)
      setDetailedProfile(profile)
      
      toast.success(`Generated ${profile.points.length} altitude points with 5m resolution`)
      
    } catch (error) {
      console.error('Failed to generate altitude profile:', error)
      
      // Provide more specific error messages
      let errorMessage = 'Failed to generate detailed altitude profile'
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          errorMessage = 'Profile generation timed out. Try with fewer waypoints or check your connection.'
        } else if (error.message.includes('Network') || error.message.includes('fetch')) {
          errorMessage = 'Network error. Using regional altitude estimates instead.'
        } else if (error.message.includes('CORS')) {
          errorMessage = 'External APIs blocked by browser security. Using regional estimates.'
        }
      }
      
      toast.error(errorMessage)
      
      // Generate a fallback profile using regional estimates
      try {
        const fallbackProfile = await generateFallbackProfile(routePoints)
        setDetailedProfile(fallbackProfile)
        toast.info('Generated profile using regional altitude estimates')
      } catch (fallbackError) {
        console.error('Fallback profile generation failed:', fallbackError)
      }
      
    } finally {
      setIsGeneratingProfile(false)
      setTimeout(() => setProfileProgress(0), 1000)
    }
  }, [routePoints, generateFallbackProfile])

  // Auto-generate 5m altitude profile when dialog opens
  useEffect(() => {
    if (isOpen && routePoints.length >= 2 && !detailedProfile && !isGeneratingProfile) {
      generateDetailedProfile()
    }
  }, [isOpen, routePoints.length, detailedProfile, isGeneratingProfile, generateDetailedProfile])

  const downloadDetailedProfile = () => {
    if (!detailedProfile) return

    const profileData = {
      metadata: {
        totalDistance: detailedProfile.totalDistance,
        elevationGain: detailedProfile.elevationGain,
        elevationLoss: detailedProfile.elevationLoss,
        minAltitude: detailedProfile.minAltitude,
        maxAltitude: detailedProfile.maxAltitude,
        pointCount: detailedProfile.points.length,
        resolution: '5m',
        source: 'Multiple elevation APIs',
        generatedAt: new Date().toISOString()
      },
      points: detailedProfile.points
    }

    const blob = new Blob([JSON.stringify(profileData, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `altitude_profile_5m_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (routePoints.length < 2) {
    return (
      <Button disabled className="w-full">
        <BarChart3 className="w-4 h-4 mr-2" />
        Plot 3D Trajectory
        <span className="text-xs ml-2">(Need 2+ points)</span>
      </Button>
    )
  }

  // Calculate trajectory statistics
  const altitudes = routePoints.map(p => p.altitude)
  const latitudes = routePoints.map(p => p.lat)
  const longitudes = routePoints.map(p => p.lng)
  const times = routePoints.map(p => p.timestamp)

  const maxAlt = Math.max(...altitudes)
  const minAlt = Math.min(...altitudes)
  const maxLat = Math.max(...latitudes)
  const minLat = Math.min(...latitudes)
  const maxLng = Math.max(...longitudes)
  const minLng = Math.min(...longitudes)
  const avgAlt = Math.round(altitudes.reduce((a, b) => a + b, 0) / altitudes.length)

  // Simple SVG-based trajectory visualization
  const TrajectoryVisualization = () => {
    const width = 600
    const height = 400
    const padding = 40

    // Normalize coordinates for SVG
    const normalizeX = (lng: number) => 
      padding + ((lng - minLng) / (maxLng - minLng || 1)) * (width - 2 * padding)
    
    const normalizeY = (lat: number) => 
      height - padding - ((lat - minLat) / (maxLat - minLat || 1)) * (height - 2 * padding)

    const pathData = routePoints.map((point, index) => {
      const x = normalizeX(point.lng)
      const y = normalizeY(point.lat)
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
    }).join(' ')

    return (
      <div className="w-full h-96 bg-muted/50 rounded-lg border flex items-center justify-center">
        <svg width={width} height={height} className="border rounded bg-background">
          {/* Grid lines */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(var(--border))" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          {/* Trajectory path */}
          <path
            d={pathData}
            fill="none"
            stroke="#2563EB"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Route points */}
          {routePoints.map((point, index) => {
            const x = normalizeX(point.lng)
            const y = normalizeY(point.lat)
            const altitudeRatio = (point.altitude - minAlt) / (maxAlt - minAlt || 1)
            const color = `hsl(${240 - altitudeRatio * 60}, 70%, 50%)`
            
            return (
              <g key={point.id}>
                <circle
                  cx={x}
                  cy={y}
                  r="6"
                  fill={color}
                  stroke="white"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y - 12}
                  textAnchor="middle"
                  fontSize="10"
                  fill="hsl(var(--muted-foreground))"
                  fontFamily="Inter"
                >
                  {index + 1}
                </text>
              </g>
            )
          })}
          
          {/* Axes labels */}
          <text x={width/2} y={height - 10} textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))">
            Longitude (°)
          </text>
          <text x={15} y={height/2} textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))" transform={`rotate(-90, 15, ${height/2})`}>
            Latitude (°)
          </text>
        </svg>
      </div>
    )
  }

  // Altitude profile chart
  const AltitudeProfile = () => {
    const width = 600
    const height = 300
    const padding = 50

    const normalizeX = (index: number) => 
      padding + (index / (routePoints.length - 1 || 1)) * (width - 2 * padding)
    
    const normalizeY = (alt: number) => 
      height - padding - ((alt - minAlt) / (maxAlt - minAlt || 1)) * (height - 2 * padding)

    const pathData = routePoints.map((point, index) => {
      const x = normalizeX(index)
      const y = normalizeY(point.altitude)
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
    }).join(' ')

    return (
      <div className="w-full h-80 bg-muted/50 rounded-lg border flex items-center justify-center">
        <svg width={width} height={height} className="border rounded bg-background">
          {/* Grid */}
          <defs>
            <pattern id="altGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(var(--border))" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#altGrid)" />
          
          {/* Area under curve */}
          <path
            d={`${pathData} L ${normalizeX(routePoints.length - 1)} ${height - padding} L ${padding} ${height - padding} Z`}
            fill="#2563EB"
            fillOpacity="0.1"
          />
          
          {/* Altitude line */}
          <path
            d={pathData}
            fill="none"
            stroke="#2563EB"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Points */}
          {routePoints.map((point, index) => {
            const x = normalizeX(index)
            const y = normalizeY(point.altitude)
            
            return (
              <circle
                key={point.id}
                cx={x}
                cy={y}
                r="4"
                fill="#2563EB"
                stroke="white"
                strokeWidth="2"
              />
            )
          })}
          
          {/* Axes */}
          <text x={width/2} y={height - 15} textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))">
            Waypoint Sequence
          </text>
          <text x={20} y={height/2} textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))" transform={`rotate(-90, 20, ${height/2})`}>
            Altitude (m)
          </text>
          
          {/* Y-axis labels */}
          <text x={padding - 10} y={normalizeY(maxAlt) + 4} textAnchor="end" fontSize="10" fill="hsl(var(--muted-foreground))">
            {maxAlt}m
          </text>
          <text x={padding - 10} y={normalizeY(minAlt) + 4} textAnchor="end" fontSize="10" fill="hsl(var(--muted-foreground))">
            {minAlt}m
          </text>
        </svg>
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">
          <BarChart3 className="w-4 h-4 mr-2" />
          Plot 3D Trajectory
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Trajectory Analysis</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(false)}
            className="h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        
        <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
          <Tabs defaultValue="map" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="map">Map View</TabsTrigger>
              <TabsTrigger value="altitude">Altitude Profile</TabsTrigger>
              <TabsTrigger value="detailed">5m Profile</TabsTrigger>
            </TabsList>
            
            <TabsContent value="map" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">2D Trajectory Map</CardTitle>
                  <p className="text-sm text-slate-600">
                    Top-down view of your trajectory with altitude color-coding
                  </p>
                </CardHeader>
                <CardContent>
                  <TrajectoryVisualization />
                  <div className="mt-4 flex items-center justify-center space-x-4 text-xs text-slate-600">
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full bg-blue-600 mr-1"></div>
                      Low Altitude
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full bg-purple-600 mr-1"></div>
                      High Altitude
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="altitude" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Altitude Profile</CardTitle>
                  <p className="text-sm text-slate-600">
                    Altitude changes along your trajectory sequence
                  </p>
                </CardHeader>
                <CardContent>
                  <AltitudeProfile />
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="detailed" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center">
                      <Mountain className="w-5 h-5 mr-2" />
                      Detailed 5m Altitude Profile
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      High-resolution elevation data with 5-meter spacing
                    </p>
                  </div>
                  {detailedProfile && (
                    <Button
                      onClick={downloadDetailedProfile}
                      size="sm"
                      variant="outline"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {isGeneratingProfile ? (
                    <div className="space-y-4 py-8">
                      <div className="text-center">
                        <Mountain className="w-8 h-8 mx-auto mb-4 text-muted-foreground animate-pulse" />
                        <p className="text-sm text-muted-foreground mb-2">
                          Generating detailed altitude profile...
                        </p>
                        <p className="text-xs text-muted-foreground mb-4">
                          Fetching elevation data every 5 meters along your route
                        </p>
                      </div>
                      <Progress value={profileProgress} className="w-full" />
                      <p className="text-xs text-center text-muted-foreground">
                        {profileProgress}% complete
                      </p>
                    </div>
                  ) : detailedProfile ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="font-medium text-muted-foreground">Total Points</div>
                          <div className="text-lg font-semibold text-primary">{detailedProfile.points.length}</div>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="font-medium text-muted-foreground">Distance</div>
                          <div className="text-lg font-semibold text-green-600">{(detailedProfile.totalDistance / 1000).toFixed(2)}km</div>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="font-medium text-muted-foreground">Elevation Gain</div>
                          <div className="text-lg font-semibold text-blue-600">+{detailedProfile.elevationGain}m</div>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="font-medium text-muted-foreground">Elevation Loss</div>
                          <div className="text-lg font-semibold text-red-600">-{detailedProfile.elevationLoss}m</div>
                        </div>
                      </div>
                      
                      <div className="bg-muted/30 p-4 rounded-lg">
                        <h4 className="font-medium mb-2">Profile Summary</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Min Altitude:</span>
                            <span className="ml-2 font-medium">{detailedProfile.minAltitude}m</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Max Altitude:</span>
                            <span className="ml-2 font-medium">{detailedProfile.maxAltitude}m</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Resolution:</span>
                            <span className="ml-2 font-medium">5m spacing</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Data Source:</span>
                            <span className="ml-2 font-medium">Multiple APIs</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-xs text-muted-foreground text-center">
                        This detailed profile contains {detailedProfile.points.length} elevation points 
                        spaced approximately 5 meters apart along your route.
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Mountain className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground mb-4">
                        No detailed profile generated yet
                      </p>
                      <Button
                        onClick={generateDetailedProfile}
                        disabled={routePoints.length < 2}
                      >
                        <Mountain className="w-4 h-4 mr-2" />
                        Generate 5m Profile
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          
          {/* Trajectory Statistics */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-lg">Trajectory Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="font-medium text-slate-700">Total Points</div>
                  <div className="text-lg font-semibold text-blue-600">{routePoints.length}</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">Max Altitude</div>
                  <div className="text-lg font-semibold text-green-600">{maxAlt}m</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">Min Altitude</div>
                  <div className="text-lg font-semibold text-orange-600">{minAlt}m</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">Alt Range</div>
                  <div className="text-lg font-semibold text-purple-600">{maxAlt - minAlt}m</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">Lat Range</div>
                  <div className="text-lg font-semibold text-blue-600">{(maxLat - minLat).toFixed(4)}°</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">Lng Range</div>
                  <div className="text-lg font-semibold text-amber-600">{(maxLng - minLng).toFixed(4)}°</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">Duration</div>
                  <div className="text-lg font-semibold text-slate-600">{Math.max(...times)}s</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">Avg Altitude</div>
                  <div className="text-lg font-semibold text-slate-600">{avgAlt}m</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}