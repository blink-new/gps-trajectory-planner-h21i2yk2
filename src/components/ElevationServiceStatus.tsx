import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { CheckCircle, XCircle, RefreshCw, AlertTriangle, Info } from 'lucide-react'
import { altitudeService } from '../services/altitudeService'

interface ServiceStatusProps {
  onClose?: () => void
}

export function ElevationServiceStatus({ onClose }: ServiceStatusProps) {
  const [status, setStatus] = useState<{ available: string[], unavailable: string[] } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const checkServiceStatus = async () => {
    setIsLoading(true)
    try {
      const serviceStatus = await altitudeService.getServiceStatus()
      setStatus(serviceStatus)
    } catch (error) {
      console.error('Failed to check service status:', error)
      setStatus({ 
        available: ['Regional Altitude Estimates (Always available)'], 
        unavailable: ['Service check failed - network error'] 
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    checkServiceStatus()
  }, [])

  const liveAPIsAvailable = status?.available.filter(s => !s.includes('Regional')).length || 0
  const hasLiveAPIs = liveAPIsAvailable > 0

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Elevation Service Status</CardTitle>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              ×
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">Checking services...</span>
          </div>
        ) : status ? (
          <>
            {/* Status Summary */}
            {hasLiveAPIs ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-start">
                  <CheckCircle className="w-4 h-4 text-green-600 mr-2 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800">Live elevation APIs available</p>
                    <p className="text-green-700 mt-1">
                      {liveAPIsAvailable} API{liveAPIsAvailable !== 1 ? 's' : ''} providing real-time elevation data.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-start">
                  <Info className="w-4 h-4 text-blue-600 mr-2 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-800">Using regional estimates</p>
                    <p className="text-blue-700 mt-1">
                      External APIs blocked by browser security (CORS). Regional estimates provide good accuracy for this area.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Available Services */}
            {status.available.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-green-700 mb-2 flex items-center">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Available Services
                </h4>
                <div className="space-y-1">
                  {status.available.map((service) => (
                    <Badge 
                      key={service} 
                      variant="secondary" 
                      className={service.includes('Regional') 
                        ? "bg-blue-100 text-blue-800" 
                        : "bg-green-100 text-green-800"
                      }
                    >
                      {service}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Unavailable Services */}
            {status.unavailable.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-red-700 mb-2 flex items-center">
                  <XCircle className="w-4 h-4 mr-1" />
                  Blocked/Unavailable Services
                </h4>
                <div className="space-y-1">
                  {status.unavailable.map((service) => (
                    <Badge key={service} variant="secondary" className="bg-red-100 text-red-800">
                      {service}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* API Key Information */}
            {(status.unavailable.some(s => s.includes('API key required')) || 
              status.unavailable.some(s => s.includes('Demo API key') || s.includes('expired'))) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-start">
                  <Info className="w-4 h-4 text-blue-600 mr-2 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-800">API Key Required</p>
                    <p className="text-blue-700 mt-1">
                      Some elevation services (like IGN France) require API keys for access. The app uses regional estimates when APIs are unavailable.
                    </p>
                    <p className="text-blue-700 mt-1 text-xs">
                      For production use, you can register for free API keys from elevation service providers.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* CORS Information */}
            {status.unavailable.some(s => s.includes('CORS')) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mr-2 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">CORS Security Notice</p>
                    <p className="text-amber-700 mt-1">
                      External elevation APIs are blocked by browser security policies (CORS). This is normal and expected behavior for web applications.
                    </p>
                    <p className="text-amber-700 mt-1 text-xs">
                      The app automatically falls back to regional altitude estimates which provide good accuracy for the Toulouse area.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Network Error Information */}
            {status.unavailable.some(s => s.includes('Network') || s.includes('Failed to fetch')) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-start">
                  <Info className="w-4 h-4 text-blue-600 mr-2 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-800">Network Information</p>
                    <p className="text-blue-700 mt-1">
                      Some APIs may be temporarily unavailable or experiencing network issues. The app includes automatic retry logic and regional fallbacks.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={checkServiceStatus}
                disabled={isLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              
              <div className="text-xs text-muted-foreground">
                {hasLiveAPIs 
                  ? `${liveAPIsAvailable} live API${liveAPIsAvailable !== 1 ? 's' : ''} + regional fallback`
                  : 'Regional estimates only'
                }
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Failed to check service status</p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={checkServiceStatus}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}