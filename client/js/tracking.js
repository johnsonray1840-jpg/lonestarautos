let map;
let marker;
let routeLayer;

// Initialize map when tracking results are shown
function initMap(lat, lng) {
    if (map) {
        map.remove();
    }
    
    map = L.map('map').setView([lat, lng], 10);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    // Add custom marker
    const customIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="background: #6366f1; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
    marker.bindPopup('<b>Current Location</b><br>Vehicle in transit').openPopup();
}

// Draw route between pickup and delivery
function drawRoute(pickupCoords, deliveryCoords) {
    if (routeLayer) {
        map.removeLayer(routeLayer);
    }
    
    const latlngs = [
        [pickupCoords.lat, pickupCoords.lng],
        [deliveryCoords.lat, deliveryCoords.lng]
    ];
    
    routeLayer = L.polyline(latlngs, {
        color: '#6366f1',
        weight: 4,
        opacity: 0.6,
        dashArray: '10, 10'
    }).addTo(map);
    
    // Add markers for pickup and delivery
    const pickupIcon = L.divIcon({
        className: 'pickup-marker',
        html: '<div style="background: #10b981; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white;"></div>',
        iconSize: [16, 16]
    });
    
    const deliveryIcon = L.divIcon({
        className: 'delivery-marker',
        html: '<div style="background: #ef4444; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white;"></div>',
        iconSize: [16, 16]
    });
    
    L.marker([pickupCoords.lat, pickupCoords.lng], { icon: pickupIcon })
        .addTo(map)
        .bindPopup('<b>Pickup Location</b>');
        
    L.marker([deliveryCoords.lat, deliveryCoords.lng], { icon: deliveryIcon })
        .addTo(map)
        .bindPopup('<b>Delivery Location</b>');
    
    // Fit bounds to show entire route
    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
}

// Update location on map
function updateLocation(lat, lng) {
    if (marker) {
        marker.setLatLng([lat, lng]);
        map.setView([lat, lng], 12);
    }
}

// Format date
function formatDate(date) {
    return new Date(date).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Get status badge class
function getStatusClass(status) {
    const statusMap = {
        'pending': 'pending',
        'pickup-scheduled': 'pickup-scheduled',
        'in-transit': 'in-transit',
        'at-terminal': 'at-terminal',
        'out-for-delivery': 'out-for-delivery',
        'delivered': 'delivered',
        'delayed': 'delayed'
    };
    return statusMap[status] || 'pending';
}

// Display tracking information
function displayTrackingInfo(data) {
    // Show results section
    document.getElementById('trackingResults').style.display = 'block';
    
    // Basic info
    document.getElementById('displayTrackingNumber').textContent = data.trackingNumber;
    document.getElementById('customerName').textContent = data.customerName;
    document.getElementById('vehicleInfo').textContent = `${data.vehicleInfo.year} ${data.vehicleInfo.make} ${data.vehicleInfo.model}`;
    
    // Route info
    document.getElementById('pickupLocation').textContent = `${data.pickupLocation.address}, ${data.pickupLocation.city}, ${data.pickupLocation.state} ${data.pickupLocation.zipCode}`;
    document.getElementById('deliveryLocation').textContent = `${data.deliveryLocation.address}, ${data.deliveryLocation.city}, ${data.deliveryLocation.state} ${data.deliveryLocation.zipCode}`;
    document.getElementById('estimatedDelivery').textContent = data.estimatedDelivery ? formatDate(data.estimatedDelivery) : 'To be confirmed';
    
    // Status
    const statusBadge = document.getElementById('statusBadge');
    const statusClass = getStatusClass(data.status);
    statusBadge.className = `status-badge ${statusClass}`;
    document.getElementById('currentStatus').textContent = data.status.replace(/-/g, ' ').toUpperCase();
    
    // Current location
    if (data.currentLocation) {
        document.getElementById('currentLocation').textContent = `${data.currentLocation.address || ''}, ${data.currentLocation.city || ''}, ${data.currentLocation.state || ''}`;
        document.getElementById('lastUpdated').textContent = data.currentLocation.lastUpdated ? formatDate(data.currentLocation.lastUpdated) : 'Not available';
        
        // Update map if coordinates available
        if (data.currentLocation.coordinates && data.currentLocation.coordinates.lat) {
            if (!map) {
                initMap(data.currentLocation.coordinates.lat, data.currentLocation.coordinates.lng);
            } else {
                updateLocation(data.currentLocation.coordinates.lat, data.currentLocation.coordinates.lng);
            }
        }
    }
    
    // Carrier info
    if (data.carrierInfo) {
        document.getElementById('carrierCompany').textContent = data.carrierInfo.company || 'To be assigned';
        document.getElementById('driverName').textContent = data.carrierInfo.driverName || 'To be assigned';
        document.getElementById('driverPhone').textContent = data.carrierInfo.driverPhone || 'To be assigned';
    }
    
    // Status history
    const historyContainer = document.getElementById('statusHistory');
    historyContainer.innerHTML = '';
    
    if (data.statusHistory && data.statusHistory.length > 0) {
        data.statusHistory.reverse().forEach(item => {
            const timelineItem = document.createElement('div');
            timelineItem.className = 'timeline-item';
            timelineItem.innerHTML = `
                <div class="timeline-date">${formatDate(item.timestamp)}</div>
                <div class="timeline-status">${item.status.replace(/-/g, ' ').toUpperCase()}</div>
                <div class="timeline-location">${item.location || ''}</div>
                <div class="timeline-description">${item.description || ''}</div>
            `;
            historyContainer.appendChild(timelineItem);
        });
    }
    
    // Draw route if pickup and delivery coordinates available
    if (data.pickupLocation.coordinates && data.deliveryLocation.coordinates) {
        drawRoute(data.pickupLocation.coordinates, data.deliveryLocation.coordinates);
    }
}

// Track shipment
document.getElementById('trackBtn')?.addEventListener('click', async () => {
    const trackingNumber = document.getElementById('trackingNumber').value.trim();
    
    if (!trackingNumber) {
        alert('Please enter a tracking number');
        return;
    }
    
    // Show loading
    const trackBtn = document.getElementById('trackBtn');
    const originalText = trackBtn.textContent;
    trackBtn.textContent = 'Tracking...';
    trackBtn.disabled = true;
    
    try {
        const response = await fetch(`/api/shipments/track/${trackingNumber}`);
        const data = await response.json();
        
        if (response.ok) {
            displayTrackingInfo(data);
        } else {
            alert(data.error || 'Shipment not found');
            document.getElementById('trackingResults').style.display = 'none';
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to track shipment. Please try again.');
        document.getElementById('trackingResults').style.display = 'none';
    } finally {
        trackBtn.textContent = originalText;
        trackBtn.disabled = false;
    }
});

// Allow Enter key to trigger tracking
document.getElementById('trackingNumber')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('trackBtn').click();
    }
});