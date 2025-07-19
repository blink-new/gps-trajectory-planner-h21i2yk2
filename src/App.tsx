// Import Leaflet CSS first
import 'leaflet/dist/leaflet.css'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet'
import { LatLng, Icon } from 'leaflet'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Separator } from './components/ui/separator'
import { Badge } from './components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Progress } from './components/ui/progress'
import { Trash2, Download, Upload, RotateCcw, MapPin, Clock, Ruler, Mountain } from 'lucide-react'
import { TrajectoryPlotter } from './components/TrajectoryPlotter'
import { ElevationServiceStatus } from './components/ElevationServiceStatus'
import { toast, Toaster } from 'sonner'
import { altitudeService } from './services/altitudeService'
import { Moon, Sun, Activity } from 'lucide-react'

// Fix for default markers in react-leaflet - use a more robust approach
const fixLeafletIcons = () => {
  try {
    delete (Icon.Default.prototype as any)._getIconUrl
    Icon.Default.mergeOptions({
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    })
  } catch (error) {
    console.warn('Failed to fix Leaflet icons:', error)
  }
}

interface RoutePoint {
  id: string
  lat: number
  lng: number
  altitude: number
  timestamp: number
  name: string
}

interface TrajectoryData {
  points: RoutePoint[]
  totalDistance: number
  totalTime: number
  createdAt: string
}

// Toulouse coordinates
const TOULOUSE_CENTER: [number, number] = [43.6047, 1.4442]

function MapClickHandler({ onMapClick }: { onMapClick: (latlng: LatLng) => void }) {
  useMapEvents({
    click: (e) => {
      try {
        // Prevent any default behavior that might cause page refresh
        if (e.originalEvent) {
          e.originalEvent.preventDefault()
          e.originalEvent.stopPropagation()
          e.originalEvent.stopImmediatePropagation()
        }
        // Call the handler in a try-catch to prevent any errors from bubbling up
        onMapClick(e.latlng)
      } catch (error) {
        console.error('Map click handler error:', error)
      }
    },
  })
  return null
}

function App() {
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([])
  const [selectedPoint, setSelectedPoint] = useState<RoutePoint | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isFetchingElevation, setIsFetchingElevation] = useState(false)
  const [elevationStatus, setElevationStatus] = useState<string>('')
  const [mapReady, setMapReady] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [showServiceStatus, setShowServiceStatus] = useState(false)
  const [elevationDataSource, setElevationDataSource] = useState<string>('auto')
  const [elevationProgress, setElevationProgress] = useState(0)
  const [autoFetchElevation, setAutoFetchElevation] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize Leaflet icons and dark mode on component mount
  useEffect(() => {
    fixLeafletIcons()
    setMapReady(true)
    // Apply dark mode to document
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    
    // Add global error handler to prevent unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason)
      event.preventDefault() // Prevent default browser behavior
    }
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [isDarkMode])

  // Enhanced elevation fetching using multiple elevation APIs
  const fetchElevationForPoint = useCallback(async (point: RoutePoint) => {
    try {
      setIsFetchingElevation(true)
      setElevationProgress(0)
      setElevationStatus('Fetching elevation data...')
      
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setElevationProgress(prev => Math.min(prev + 20, 80))
      }, 200)
      
      const altitude = await altitudeService.getAltitude(point.lat, point.lng, 0, elevationDataSource)
      
      clearInterval(progressInterval)
      setElevationProgress(100)
      
      setRoutePoints(prev => prev.map(p => 
        p.id === point.id ? { ...p, altitude } : p
      ))
      setSelectedPoint(prev => 
        prev?.id === point.id ? { ...prev, altitude } : prev
      )
      
      const isInFrance = altitudeService.isInFrance(point.lat, point.lng)
      const region = isInFrance ? 'France region' : 'Global coverage'
      
      // Check if this is likely a fallback value (no API worked)
      const isLikelyFallback = (
        altitude % 50 === 0 || 
        (altitude >= 100 && altitude <= 300 && altitude % 10 === 0) ||
        (isInFrance && altitude >= 150 && altitude <= 200)
      )
      
      if (isLikelyFallback) {
        toast.warning(`Elevation estimated: ${altitude}m (${region})`, {
          description: 'Using regional estimates - elevation APIs may be unavailable. Check Service Status for details.'
        })
      } else {
        toast.success(`Elevation updated: ${altitude}m (${region})`, {
          description: `Retrieved from ${elevationDataSource === 'auto' ? 'live elevation API' : elevationDataSource}`
        })
      }
      
    } catch (error) {
      console.error('Elevation fetch failed:', error)
      
      // Fallback to regional estimate
      const fallbackAltitude = altitudeService.isInFrance(point.lat, point.lng) ? 150 : 200
      
      setRoutePoints(prev => prev.map(p => 
        p.id === point.id ? { ...p, altitude: fallbackAltitude } : p
      ))
      setSelectedPoint(prev => 
        prev?.id === point.id ? { ...prev, altitude: fallbackAltitude } : prev
      )
      
      // Provide more helpful error message with better categorization
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const isInFrance = altitudeService.isInFrance(point.lat, point.lng)
      const region = isInFrance ? 'France region' : 'Global coverage'
      
      if (errorMessage.includes('CORS') || errorMessage.includes('cors') || errorMessage.includes('Cross-Origin')) {
        toast.info(`Using regional estimate: ${fallbackAltitude}m (${region})`, {
          description: 'External APIs blocked by browser security (CORS). This is normal for web apps.'
        })
      } else if (errorMessage.includes('Network') || errorMessage.includes('Failed to fetch')) {
        if (errorMessage.includes('Demo API key') || errorMessage.includes('choisirgeoportail')) {
          toast.info(`Using regional estimate: ${fallbackAltitude}m (${region})`, {
            description: 'IGN demo API key expired. Regional estimates provide good accuracy for France.'
          })
        } else {
          toast.warning(`Using regional estimate: ${fallbackAltitude}m (${region})`, {
            description: 'Network error or API unavailable. Check Service Status for details.'
          })
        }
      } else if (errorMessage.includes('timeout') || errorMessage.includes('AbortError')) {
        toast.warning(`Using regional estimate: ${fallbackAltitude}m (${region})`, {
          description: 'API response timeout. Using regional fallback.'
        })
      } else if (errorMessage.includes('403') || errorMessage.includes('401')) {
        toast.info(`Using regional estimate: ${fallbackAltitude}m (${region})`, {
          description: 'API authentication required. Using regional estimates instead.'
        })
      } else {
        toast.info(`Using regional estimate: ${fallbackAltitude}m (${region})`, {
          description: 'Elevation APIs unavailable. Regional estimates provide good accuracy.'
        })
      }
    } finally {
      setIsFetchingElevation(false)
      setElevationStatus('')
      setTimeout(() => setElevationProgress(0), 1000) // Reset progress after delay
    }
  }, [elevationDataSource])

  const addRoutePoint = useCallback(async (latlng: LatLng) => {
    try {
      // Prevent any potential form submission or page refresh
      const newPoint: RoutePoint = {
        id: `point_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        lat: latlng.lat,
        lng: latlng.lng,
        altitude: 100, // Default altitude in meters
        timestamp: routePoints.length * 10, // 10 seconds between points
        name: `Waypoint ${routePoints.length + 1}`
      }
      
      // Use functional state updates to prevent race conditions
      setRoutePoints(prev => [...prev, newPoint])
      setSelectedPoint(newPoint)
      
      // Auto-fetch elevation for new points if enabled
      if (autoFetchElevation) {
        // Use setTimeout to ensure the UI update happens first
        setTimeout(() => {
          fetchElevationForPoint(newPoint).catch(error => {
            console.error('Failed to fetch elevation for new point:', error)
          })
        }, 0)
      }
    } catch (error) {
      console.error('Failed to add route point:', error)
      // Prevent error from bubbling up and causing page refresh
      return false
    }
  }, [routePoints.length, autoFetchElevation, fetchElevationForPoint])

  const removeRoutePoint = useCallback((id: string) => {
    setRoutePoints(prev => prev.filter(point => point.id !== id))
    setSelectedPoint(null)
  }, [])

  const updateRoutePoint = useCallback((id: string, updates: Partial<RoutePoint>) => {
    setRoutePoints(prev => prev.map(point => 
      point.id === id ? { ...point, ...updates } : point
    ))
    if (selectedPoint?.id === id) {
      setSelectedPoint(prev => prev ? { ...prev, ...updates } : null)
    }
  }, [selectedPoint])

  const clearAllPoints = useCallback(() => {
    setRoutePoints([])
    setSelectedPoint(null)
  }, [])

  const calculateDistance = useCallback((p1: RoutePoint, p2: RoutePoint): number => {
    const R = 6371000 // Earth's radius in meters
    const dLat = (p2.lat - p1.lat) * Math.PI / 180
    const dLng = (p2.lng - p1.lng) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }, [])

  const generateTrajectory = useCallback(async () => {
    if (routePoints.length < 2) return

    setIsGenerating(true)
    
    // Simulate trajectory generation
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    let totalDistance = 0
    for (let i = 1; i < routePoints.length; i++) {
      totalDistance += calculateDistance(routePoints[i-1], routePoints[i])
    }

    const trajectoryData: TrajectoryData = {
      points: routePoints,
      totalDistance,
      totalTime: routePoints[routePoints.length - 1]?.timestamp || 0,
      createdAt: new Date().toISOString()
    }

    // Download trajectory data
    const blob = new Blob([JSON.stringify(trajectoryData, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trajectory_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)

    setIsGenerating(false)
  }, [routePoints, calculateDistance])

  const importTrajectory = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.preventDefault()
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as TrajectoryData
        setRoutePoints(data.points || [])
        toast.success(`Imported ${data.points?.length || 0} waypoints`)
      } catch (error) {
        console.error('Failed to import trajectory:', error)
        toast.error('Failed to import trajectory file')
      }
    }
    reader.onerror = () => {
      toast.error('Failed to read trajectory file')
    }
    reader.readAsText(file)
    
    // Reset the input value to allow re-importing the same file
    event.target.value = ''
  }, [])

  const fetchElevationData = useCallback(async (point: RoutePoint) => {
    if (!point) return

    setIsFetchingElevation(true)
    try {
      await fetchElevationForPoint(point)
    } finally {
      setIsFetchingElevation(false)
    }
  }, [fetchElevationForPoint])



  const totalDistance = routePoints.length > 1 
    ? routePoints.slice(1).reduce((acc, point, index) => 
        acc + calculateDistance(routePoints[index], point), 0)
    : 0

  const totalTime = routePoints.length > 0 
    ? routePoints[routePoints.length - 1]?.timestamp || 0 
    : 0

  return (
    <div className="min-h-screen bg-background flex" onSubmit={(e) => e.preventDefault()} onReset={(e) => e.preventDefault()}>
      <Toaster 
        position="top-right" 
        theme={isDarkMode ? "dark" : "light"}
        richColors
        closeButton
      />
      {/* Control Panel Sidebar */}
      <div className="w-80 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-semibold text-foreground">
              GPS Route Planner
            </h1>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="h-8 w-8 p-0"
            >
              {isDarkMode ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Click on the map to add waypoints for 3D trajectory generation
          </p>
        </div>

        {/* Route Statistics */}
        <div className="p-4 border-b border-border">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center mb-1">
                <MapPin className="w-4 h-4 text-primary mr-1" />
                <span className="text-sm font-medium text-foreground">Points</span>
              </div>
              <div className="text-lg font-semibold text-foreground">
                {routePoints.length}
              </div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center mb-1">
                <Ruler className="w-4 h-4 text-green-500 mr-1" />
                <span className="text-sm font-medium text-foreground">Distance</span>
              </div>
              <div className="text-lg font-semibold text-foreground">
                {(totalDistance / 1000).toFixed(1)}km
              </div>
            </div>
            <div className="text-center col-span-2">
              <div className="flex items-center justify-center mb-1">
                <Clock className="w-4 h-4 text-amber-500 mr-1" />
                <span className="text-sm font-medium text-foreground">Duration</span>
              </div>
              <div className="text-lg font-semibold text-foreground">
                {totalTime}s
              </div>
            </div>
          </div>
        </div>

        {/* Elevation Settings */}
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-medium text-foreground mb-3 flex items-center">
            <Mountain className="w-4 h-4 mr-2" />
            Elevation Settings
          </h3>
          <div className="space-y-3">
            <div>
              <Label htmlFor="elevation-source" className="text-xs mb-1 block">Data Source</Label>
              <Select value={elevationDataSource} onValueChange={setElevationDataSource}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select elevation source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Multiple APIs)</SelectItem>
                  <SelectItem value="opentopodata-srtm30m">OpenTopoData SRTM30m (Global)</SelectItem>
                  <SelectItem value="opentopodata-eudem">OpenTopoData EU-DEM (Europe)</SelectItem>
                  <SelectItem value="open-elevation">Open-Elevation (Global)</SelectItem>
                  <SelectItem value="ign-rge-alti">IGN RGE ALTI (France)</SelectItem>
                  <SelectItem value="opentopodata-aster">OpenTopoData ASTER30m (Global)</SelectItem>
                  <SelectItem value="regional">Regional Estimates</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-fetch" className="text-xs">Auto-fetch on pin drop</Label>
              <Button
                type="button"
                variant={autoFetchElevation ? "default" : "outline"}
                size="sm"
                onClick={() => setAutoFetchElevation(!autoFetchElevation)}
                className="h-6 px-2 text-xs"
              >
                {autoFetchElevation ? "ON" : "OFF"}
              </Button>
            </div>
            
            {isFetchingElevation && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Fetching elevation...</span>
                  <span className="text-xs text-muted-foreground">{elevationProgress}%</span>
                </div>
                <Progress value={elevationProgress} className="h-1" />
              </div>
            )}
          </div>
        </div>

        {/* Selected Waypoint Display */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Selected Waypoint</h3>
            {!selectedPoint ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {routePoints.length === 0 
                  ? "Click on the map to add your first waypoint"
                  : "Click on a waypoint marker to select it"
                }
              </p>
            ) : (
              <Card className="ring-2 ring-primary bg-primary/5">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center">
                      <Badge variant="secondary" className="mr-2">
                        {routePoints.findIndex(p => p.id === selectedPoint.id) + 1}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">{selectedPoint.name}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRoutePoint(selectedPoint.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>Lat: {selectedPoint.lat.toFixed(6)}</div>
                    <div>Lng: {selectedPoint.lng.toFixed(6)}</div>
                    <div>Alt: {selectedPoint.altitude}m</div>
                    <div>Time: {selectedPoint.timestamp}s</div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Point Editor */}
        {selectedPoint && (
          <div className="p-4 border-t border-border">
            <h3 className="text-sm font-medium text-foreground mb-3">Edit Waypoint</h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="point-name" className="text-xs">Name</Label>
                <Input
                  id="point-name"
                  value={selectedPoint.name}
                  onChange={(e) => updateRoutePoint(selectedPoint.id, { name: e.target.value })}
                  className="h-8"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label htmlFor="point-altitude" className="text-xs">Altitude (m)</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchElevationData(selectedPoint)}
                    disabled={isFetchingElevation}
                    className="h-6 px-2 text-xs"
                  >
                    <Mountain className="w-3 h-3 mr-1" />
                    {isFetchingElevation ? (elevationStatus || 'Fetching...') : 'Get Elevation'}
                  </Button>
                </div>
                <Input
                  id="point-altitude"
                  type="number"
                  value={selectedPoint.altitude}
                  onChange={(e) => updateRoutePoint(selectedPoint.id, { altitude: Number(e.target.value) })}
                  className="h-8"
                />
              </div>
              <div>
                <Label htmlFor="point-timestamp" className="text-xs">Time (s)</Label>
                <Input
                  id="point-timestamp"
                  type="number"
                  value={selectedPoint.timestamp}
                  onChange={(e) => updateRoutePoint(selectedPoint.id, { timestamp: Number(e.target.value) })}
                  className="h-8"
                />
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="p-4 border-t border-border space-y-2">
          <TrajectoryPlotter routePoints={routePoints} elevationDataSource={elevationDataSource} />
          
          <Button
            type="button"
            onClick={generateTrajectory}
            disabled={routePoints.length < 2 || isGenerating}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            {isGenerating ? 'Generating...' : 'Export Trajectory'}
          </Button>
          
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={clearAllPoints}
              disabled={routePoints.length === 0}
              className="flex-1"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
          
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowServiceStatus(!showServiceStatus)}
            className="w-full"
          >
            <Activity className="w-4 h-4 mr-2" />
            Service Status
          </Button>
          
          {showServiceStatus && (
            <div className="mt-2">
              <ElevationServiceStatus onClose={() => setShowServiceStatus(false)} />
            </div>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={importTrajectory}
            className="hidden"
          />
        </div>
      </div>

      {/* Map Container */}
      <div className="flex-1 relative">
        {!mapReady ? (
          <div className="h-full w-full flex items-center justify-center bg-background">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading map...</p>
            </div>
          </div>
        ) : (
          <MapContainer
            center={TOULOUSE_CENTER}
            zoom={12}
            className="h-full w-full"
            zoomControl={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url={isDarkMode 
                ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              }
            />
            
            <MapClickHandler onMapClick={addRoutePoint} />
            
            {/* Route Points */}
            {routePoints.map((point, index) => (
              <Marker
                key={point.id}
                position={[point.lat, point.lng]}
                eventHandlers={{
                  click: () => setSelectedPoint(point)
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-medium mb-1">{point.name}</div>
                    <div>Lat: {point.lat.toFixed(6)}</div>
                    <div>Lng: {point.lng.toFixed(6)}</div>
                    <div>Altitude: {point.altitude}m</div>
                    <div>Time: {point.timestamp}s</div>
                  </div>
                </Popup>
              </Marker>
            ))}
            
            {/* Route Path */}
            {routePoints.length > 1 && (
              <Polyline
                positions={routePoints.map(point => [point.lat, point.lng])}
                color={isDarkMode ? "#60A5FA" : "#2563EB"}
                weight={3}
                opacity={0.8}
              />
            )}
          </MapContainer>
        )}

        {/* Map Instructions Overlay */}
        {routePoints.length === 0 && mapReady && (
          <div className="absolute top-4 left-4 right-4 z-[1000]">
            <Card className="bg-card/95 backdrop-blur-sm border-border">
              <CardContent className="p-4">
                <div className="flex items-center">
                  <MapPin className="w-5 h-5 text-primary mr-3" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Click anywhere on the map to add waypoints
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Build your route by clicking points in sequence
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

export default App