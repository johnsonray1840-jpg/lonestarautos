// Initialize Stripe
const stripe = Stripe('pk_test_your_stripe_publishable_key');

// Quote form handling
document.getElementById('quoteForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = {
        customerName: document.getElementById('customerName').value,
        customerEmail: document.getElementById('customerEmail').value,
        customerPhone: document.getElementById('customerPhone').value,
        vehicleDetails: {
            year: document.getElementById('vehicleYear').value,
            make: document.getElementById('vehicleMake').value,
            model: document.getElementById('vehicleModel').value
        },
        shippingDetails: {
            pickupAddress: document.getElementById('pickupAddress').value,
            deliveryAddress: document.getElementById('deliveryAddress').value,
            preferredDate: document.getElementById('preferredDate').value
        },
        // Calculate shipping amount based on distance and vehicle type
        amount: calculateShippingCost()
    };
    
    // Show loading state
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Processing...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/orders/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.sessionId) {
            // Redirect to Stripe checkout
            stripe.redirectToCheckout({ sessionId: data.sessionId });
        } else {
            throw new Error('Failed to create checkout session');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to process request. Please try again.');
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

// Calculate shipping cost based on distance
function calculateShippingCost() {
    // This is a simplified calculation
    // In production, you'd use a distance API to calculate actual distance
    const baseRate = 500;
    const vehicleMultiplier = 1.2;
    const distanceFactor = 1.5;
    
    return Math.round(baseRate * vehicleMultiplier * distanceFactor);
}

// Modal handling
const privacyModal = document.getElementById('privacyModal');
const termsModal = document.getElementById('termsModal');
const privacyLink = document.getElementById('privacyLink');
const termsLink = document.getElementById('termsLink');
const closeBtns = document.querySelectorAll('.close');

privacyLink?.addEventListener('click', (e) => {
    e.preventDefault();
    privacyModal.style.display = 'block';
});

termsLink?.addEventListener('click', (e) => {
    e.preventDefault();
    termsModal.style.display = 'block';
});

closeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        privacyModal.style.display = 'none';
        termsModal.style.display = 'none';
    });
});

window.addEventListener('click', (e) => {
    if (e.target === privacyModal) privacyModal.style.display = 'none';
    if (e.target === termsModal) termsModal.style.display = 'none';
});

// Mobile menu toggle
const mobileMenu = document.querySelector('.mobile-menu');
const navLinks = document.querySelector('.nav-links');

mobileMenu?.addEventListener('click', () => {
    navLinks.classList.toggle('show');
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});