// API Configuration
const API_BASE = '/api';

// State
let currentUser = null;
let selectedFiles = [];
let currentTheme = localStorage.getItem('theme') || 'light';
let navbarListenersSetup = false; // Track if navbar listeners are already set up
let calendarWeekOffset = 0; // Track which week is being displayed (0 = current week)
let calendarInitialized = false; // Track if calendar has been initialized for this view

// Global encryption key for client-side cache
let encryptionKey = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize encryption for cache (non-blocking)
    try {
        if (typeof EncryptedCacheManager !== 'undefined') {
            encryptionKey = await EncryptedCacheManager.initialize();
        }
    } catch (error) {
        console.warn('Failed to initialize encryption:', error);
        // Continue anyway - caching will still work on server side
    }
    
    initializeTheme();
    initializeRouting();
    setupKeyboardShortcuts();
});

// Initialize routing - handle URL changes and browser back/forward
function initializeRouting() {
    // Handle initial page load based on URL
    handleRoute(window.location.pathname);
    
    // Handle browser back/forward buttons
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.page) {
            handleRoute(e.state.page, false); // Don't push to history again
        } else {
            handleRoute(window.location.pathname, false);
        }
    });
}

// Handle routing based on URL path
function handleRoute(path, pushState = false) {
    // Remove leading slash and query params
    const cleanPath = path.replace(/^\//, '').split('?')[0] || 'login';
    
    const token = localStorage.getItem('access_token');
    
    // Define route mappings
    const authRoutes = ['login', 'register'];
    const dashboardRoutes = ['dashboard', 'posts', 'newPost', 'settings'];
    
    if (authRoutes.includes(cleanPath)) {
        // Auth routes - accessible without login
        if (token) {
            // Already logged in, redirect to dashboard
            navigateTo('/dashboard');
        } else {
            loadPageContent('auth', pushState);
            setTimeout(() => {
                if (cleanPath === 'register') {
                    const loginPage = document.getElementById('loginPage');
                    const registerPage = document.getElementById('registerPage');
                    if (loginPage) loginPage.style.display = 'none';
                    if (registerPage) registerPage.style.display = 'flex';
                }
            }, 100);
        }
    } else if (dashboardRoutes.includes(cleanPath)) {
        // Dashboard routes - require login
        if (token) {
            fetchCurrentUser().then(() => {
                // Ensure navbar is visible for dashboard routes
                const navbar = document.getElementById('navbar');
                if (navbar) {
                    navbar.style.display = 'flex';
                    if (!navbarListenersSetup) {
                        setupNavbarListeners();
                        navbarListenersSetup = true;
                    }
                }
                // Use showView for all dashboard routes (includes dashboard itself)
                showView(cleanPath, pushState);
            }).catch(() => {
                navigateTo('/login');
            });
        } else {
            navigateTo('/login');
        }
    } else {
        // Unknown route - redirect based on auth status
        if (token) {
            navigateTo('/dashboard');
        } else {
            navigateTo('/login');
        }
    }
}

// Navigate to a new route
function navigateTo(path) {
    history.pushState({ page: path }, '', path);
    handleRoute(path, false);
}

// Check authentication
function checkAuth() {
    const token = localStorage.getItem('access_token');
    
    if (token) {
        fetchCurrentUser();
    } else {
        handleRoute(window.location.pathname);
    }
}

// Load page content dynamically from separate HTML files
async function loadPageContent(page, updateUrl = true) {
    const mainContent = document.getElementById('mainContent');
    const navbar = document.getElementById('navbar');
    
    try {
        const response = await fetch(`/pages/${page}.html`);
        if (!response.ok) throw new Error(`Failed to load page: ${page}`);
        
        const html = await response.text();
        mainContent.innerHTML = html;
        
        // Show navbar only on dashboard pages (when authenticated)
        if (page === 'dashboard') {
            navbar.style.display = 'flex';
            // Setup navbar event listeners only once
            if (!navbarListenersSetup) {
                setupNavbarListeners();
                navbarListenersSetup = true;
            }
        } else {
            navbar.style.display = 'none';
            // Setup auth listeners only for auth page
            if (page === 'auth') {
                setupAuthListeners();
            }
        }
        
        // Update URL if requested (for initial page load from checkAuth)
        if (updateUrl && page === 'auth') {
            const currentPath = window.location.pathname.replace(/^\//, '');
            if (!['login', 'register'].includes(currentPath)) {
                history.replaceState({ page: '/login' }, '', '/login');
            }
        }
    } catch (error) {
        console.error('Error loading page:', error);
        mainContent.innerHTML = '<div style="padding: 2rem; text-align: center;"><p>Error loading page. Please refresh.</p></div>';
    }
}

// Setup navbar-specific listeners (called only once)
function setupNavbarListeners() {
    const userMenuToggle = document.getElementById('userMenuToggle');
    const userDropdown = document.getElementById('userDropdown');
    const navSettings = document.getElementById('navSettings');
    const logoutBtn = document.getElementById('logoutBtn');
    const themeToggle = document.getElementById('themeToggle');
    const navDashboard = document.getElementById('navDashboard');
    const navPosts = document.getElementById('navPosts');
    const navNewPost = document.getElementById('navNewPost');
    
    // User menu toggle
    if (userMenuToggle) {
        userMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (userDropdown) {
                userDropdown.style.display = userDropdown.style.display === 'none' ? 'block' : 'none';
            }
        });
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const userMenu = document.querySelector('.user-menu');
        if (userMenu && userDropdown && !userMenu.contains(e.target)) {
            userDropdown.style.display = 'none';
        }
    });
    
    // Settings button
    if (navSettings) {
        navSettings.addEventListener('click', () => {
            navigateTo('/settings');
            if (userDropdown) userDropdown.style.display = 'none';
        });
    }
    
    // Logout button
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Theme toggle
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            toggleTheme();
            if (userDropdown) userDropdown.style.display = 'none';
        });
    }
    
    // Navigation buttons
    if (navDashboard) {
        navDashboard.addEventListener('click', () => navigateTo('/dashboard'));
    }
    if (navPosts) {
        navPosts.addEventListener('click', () => navigateTo('/posts'));
    }
    if (navNewPost) {
        navNewPost.addEventListener('click', () => navigateTo('/newPost'));
    }
}

// Helper function to close dropdown when clicking outside
function closeDropdownOutside(e) {
    const userDropdown = document.getElementById('userDropdown');
    const userMenu = document.querySelector('.user-menu');
    if (userMenu && userDropdown && !userMenu.contains(e.target)) {
        userDropdown.style.display = 'none';
    }
}

// Setup event listeners
// Setup listeners for auth pages (login/register)
function setupAuthListeners() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showRegisterBtn = document.getElementById('showRegister');
    const showLoginBtn = document.getElementById('showLogin');
    
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (showRegisterBtn) showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('/register');
    });
    if (showLoginBtn) showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('/login');
    });
}

// Setup listeners for view-specific elements
function setupViewListeners() {
    // Posts view
    const newPostForm = document.getElementById('newPostForm');
    const saveDraftBtn = document.getElementById('saveDraft');
    
    if (newPostForm) newPostForm.addEventListener('submit', handleCreatePost);
    if (saveDraftBtn) saveDraftBtn.addEventListener('click', () => handleCreatePost(null, 'draft'));
    
    // Drag and drop
    if (document.getElementById('dropZone')) setupDragAndDrop();
    
    // Media selection
    const mediaFiles = document.getElementById('mediaFiles');
    const postCaption = document.getElementById('postCaption');
    const timePeriod = document.getElementById('timePeriod');
    const scheduledTime = document.getElementById('scheduledTime');
    const prevWeekBtn = document.getElementById('prevWeek');
    const nextWeekBtn = document.getElementById('nextWeek');
    
    if (mediaFiles) mediaFiles.addEventListener('change', handleMediaSelect);
    if (postCaption) postCaption.addEventListener('input', updatePreview);
    if (timePeriod) {
        timePeriod.addEventListener('change', handleTimePeriodChange);
        // Only initialize calendar once per view
        if (!calendarInitialized) {
            calendarInitialized = true;
            calendarWeekOffset = 0; // Reset to current week
            initializeWeekCalendar();
        }
    }
    if (scheduledTime) scheduledTime.addEventListener('change', handleManualDateTimeChange);
    if (prevWeekBtn) prevWeekBtn.addEventListener('click', (e) => { e.preventDefault(); navigateWeek(-1); });
    if (nextWeekBtn) nextWeekBtn.addEventListener('click', (e) => { e.preventDefault(); navigateWeek(1); });
    
    // Dashboard / Instagram settings
    const connectInstagramBtn = document.getElementById('connectInstagram');
    const disconnectInstagramBtn = document.getElementById('disconnectInstagram');
    const instagramConfigForm = document.getElementById('instagramConfigForm');
    
    if (connectInstagramBtn) connectInstagramBtn.addEventListener('click', () => navigateTo('/settings'));
    if (disconnectInstagramBtn) disconnectInstagramBtn.addEventListener('click', disconnectInstagram);
    if (instagramConfigForm) instagramConfigForm.addEventListener('submit', connectInstagram);
    
    // Settings
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) changePasswordForm.addEventListener('submit', changePassword);
    
    // Posts view - refresh button
    const refreshAllPosts = document.getElementById('refreshAllPosts');
    const statusFilter = document.getElementById('statusFilter');
    if (refreshAllPosts) {
        refreshAllPosts.addEventListener('click', () => {
            loadAllPosts();
        });
    }
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            loadAllPosts();
        });
    }
    
    // Dashboard refresh button
    const refreshDashboardBtn = document.getElementById('refreshDashboard');
    if (refreshDashboardBtn) {
        refreshDashboardBtn.addEventListener('click', refreshDashboardData);
    }
    
    // Instagram refresh button (if exists on Instagram-specific view)
    const refreshInstagramPostsBtn = document.getElementById('refreshInstagramPosts');
    if (refreshInstagramPostsBtn) {
        refreshInstagramPostsBtn.addEventListener('click', refreshInstagramPosts);
    }
    
    // Modal
    const modalClose = document.querySelector('.modal-close');
    if (modalClose) modalClose.addEventListener('click', closeModal);
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal();
        }
    });
}

// Old function - kept for compatibility but should be refactored away
function setupEventListeners() {
    // Auth
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showRegisterBtn = document.getElementById('showRegister');
    const showLoginBtn = document.getElementById('showLogin');
    
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (showRegisterBtn) showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('/register');
    });
    if (showLoginBtn) showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('/login');
    });
    
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    // Navigation
    const navDashboard = document.getElementById('navDashboard');
    const navPosts = document.getElementById('navPosts');
    const navNewPost = document.getElementById('navNewPost');
    const navSettings = document.getElementById('navSettings');
    
    if (navDashboard) navDashboard.addEventListener('click', () => navigateTo('/dashboard'));
    if (navPosts) navPosts.addEventListener('click', () => navigateTo('/posts'));
    if (navNewPost) navNewPost.addEventListener('click', () => navigateTo('/newPost'));
    if (navSettings) navSettings.addEventListener('click', () => {
        navigateTo('/settings');
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) dropdown.style.display = 'none';
    });
    
    // Instagram
    const connectInstagramBtn = document.getElementById('connectInstagram');
    const disconnectInstagramBtn = document.getElementById('disconnectInstagram');
    const instagramConfigForm = document.getElementById('instagramConfigForm');
    
    if (connectInstagramBtn) connectInstagramBtn.addEventListener('click', () => navigateTo('/settings'));
    if (disconnectInstagramBtn) disconnectInstagramBtn.addEventListener('click', disconnectInstagram);
    if (instagramConfigForm) instagramConfigForm.addEventListener('submit', connectInstagram);
    
    // Posts
    const newPostForm = document.getElementById('newPostForm');
    const saveDraftBtn = document.getElementById('saveDraft');
    
    if (newPostForm) newPostForm.addEventListener('submit', handleCreatePost);
    if (saveDraftBtn) saveDraftBtn.addEventListener('click', () => handleCreatePost(null, 'draft'));
    
    // Drag and drop
    if (document.getElementById('dropZone')) setupDragAndDrop();
    
    // Media selection
    const mediaFiles = document.getElementById('mediaFiles');
    const postCaption = document.getElementById('postCaption');
    const scheduledTime = document.getElementById('scheduledTime');
    
    if (mediaFiles) mediaFiles.addEventListener('change', handleMediaSelect);
    if (postCaption) postCaption.addEventListener('input', updatePreview);
    if (scheduledTime) scheduledTime.addEventListener('change', updatePreview);
    
    // Settings
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) changePasswordForm.addEventListener('submit', changePassword);
    
    // Modal
    const modalClose = document.querySelector('.modal-close');
    if (modalClose) modalClose.addEventListener('click', closeModal);
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal();
        }
    });
}

// Theme Management
function initializeTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon();
}

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon();
}

function updateThemeIcon() {
    const toggleBtn = document.getElementById('themeToggle');
    const text = currentTheme === 'light' ? 'Dark Mode' : 'Light Mode';
    toggleBtn.innerHTML = text;
}

// Drag and Drop Functionality
function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('mediaFiles');
    
    // Click to browse
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
    
    // Drag over
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
    });
    
    // Drag leave
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
    });
    
    // Drop
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            // Update file input
            fileInput.files = files;
            handleMediaSelect({ target: fileInput });
        }
    });
}

// Keyboard Shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore if user is typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        // Check for modifier keys
        if (e.ctrlKey || e.metaKey) {
            switch(e.key.toLowerCase()) {
                case 'n':
                    e.preventDefault();
                    navigateTo('/newPost');
                    break;
                case 'd':
                    e.preventDefault();
                    navigateTo('/dashboard');
                    break;
                case 'p':
                    e.preventDefault();
                    navigateTo('/posts');
                    break;
                case 's':
                    e.preventDefault();
                    navigateTo('/settings');
                    break;
            }
        }
        
        // ESC to close modal
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

// Image Processing Utilities
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB per Instagram guidelines

async function processImage(file) {
    return new Promise((resolve, reject) => {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
            // Need to resize
            resizeImage(file).then(resolve).catch(reject);
        } else {
            resolve(file);
        }
    });
}

async function resizeImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Create canvas
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Calculate new dimensions (maintain aspect ratio)
                let width = img.width;
                let height = img.height;
                const maxDimension = 1080; // Instagram standard
                
                if (width > height && width > maxDimension) {
                    height = (height * maxDimension) / width;
                    width = maxDimension;
                } else if (height > maxDimension) {
                    width = (width * maxDimension) / height;
                    height = maxDimension;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw resized image
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to blob
                canvas.toBlob((blob) => {
                    if (blob) {
                        const resizedFile = new File([blob], file.name, {
                            type: file.type,
                            lastModified: Date.now()
                        });
                        resolve(resizedFile);
                    } else {
                        reject(new Error('Failed to resize image'));
                    }
                }, file.type, 0.9); // 90% quality
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Show page (auth pages) - now loads separate HTML files
function showPage(page) {
    const pageMap = {
        'login': '/login',
        'register': '/register',
        'dashboard': '/dashboard'
    };
    
    if (pageMap[page]) {
        navigateTo(pageMap[page]);
    }
}

// Show view (dashboard views) - now loads separate HTML files for each view
async function showView(view, updateUrl = true) {
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    // Reset calendar initialization flag when switching views
    if (view !== 'newPost') {
        calendarInitialized = false;
    }
    
    // Map view names to their HTML files and nav buttons
    const viewConfig = {
        'dashboard': { file: 'dashboard', nav: 'navDashboard', init: loadDashboard, url: '/dashboard' },
        'posts': { file: 'posts', nav: 'navPosts', init: loadAllPosts, url: '/posts' },
        'newPost': { file: 'create-post', nav: 'navNewPost', init: initializeNewPostView, url: '/newPost' },
        'settings': { file: 'settings', nav: 'navSettings', init: null, url: '/settings' }
    };
    
    const config = viewConfig[view];
    if (!config) return;
    
    // Update URL
    if (updateUrl) {
        history.pushState({ page: config.url }, '', config.url);
    }
    
    // Load the HTML file for this view
    try {
        const response = await fetch(`/pages/${config.file}.html`);
        if (!response.ok) throw new Error(`Failed to load ${config.file}`);
        
        const html = await response.text();
        document.getElementById('mainContent').innerHTML = html;
        
        // Activate nav button
        const navBtn = document.getElementById(config.nav);
        if (navBtn) navBtn.classList.add('active');
        
        // Don't call setupEventListeners here - it causes infinite loops
        // Setup view-specific listeners instead
        setupViewListeners();
        
        // Initialize the view (load data, etc.)
        if (config.init) {
            config.init();
        }
    } catch (error) {
        console.error('Error loading view:', error);
        document.getElementById('mainContent').innerHTML = '<div style="padding: 2rem; text-align: center;"><p>Error loading view. Please try again.</p></div>';
    }
}

// API Helper
async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('access_token');
    
    const headers = {
        ...options.headers,
    };
    
    if (token && !options.skipAuth) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });
    
    if (response.status === 401) {
        localStorage.removeItem('access_token');
        showPage('login');
        throw new Error('Unauthorized');
    }
    
    // Check if response indicates dashboard cache should be invalidated
    if (response.headers.get('X-Invalidate-Dashboard-Cache') === 'true') {
        invalidateDashboardCache();
    }
    
    return response;
}

// Cache invalidation function
function invalidateDashboardCache() {
    localStorage.removeItem('dashboard_stats');
    localStorage.removeItem('dashboard_upcoming_posts');
    // Don't remove Instagram status cache - it's less frequently updated
    
    // If dashboard is currently visible, refresh it
    if (document.getElementById('dashboardView') && document.getElementById('dashboardView').style.display !== 'none') {
        refreshDashboardData();
    }
}

// Refresh dashboard data from server
async function refreshDashboardData() {
    try {
        await checkInstagramStatus();
        await loadStats();
        await loadUpcomingPosts();
        showToast('Dashboard updated', 'success');
    } catch (error) {
        console.error('Failed to refresh dashboard:', error);
        showToast('Failed to update dashboard', 'error');
    }
}

// Auth Functions
async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await apiCall('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
            skipAuth: true,
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            currentUser = data.user;
            showToast('Login successful!', 'success');
            navigateTo('/dashboard');
        } else {
            showToast(data.error || 'Login failed', 'error');
        }
    } catch (error) {
        showToast('An error occurred', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    try {
        const response = await apiCall('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password }),
            skipAuth: true,
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            currentUser = data.user;
            showToast('Registration successful!', 'success');
            navigateTo('/dashboard');
        } else {
            showToast(data.error || 'Registration failed', 'error');
        }
    } catch (error) {
        showToast('An error occurred', 'error');
    }
}

function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    currentUser = null;
    navbarListenersSetup = false; // Reset the flag so listeners can be set up again on next login
    navigateTo('/login');
    showToast('Logged out successfully', 'info');
}

async function fetchCurrentUser() {
    try {
        const response = await apiCall('/auth/me');
        const data = await response.json();
        
        if (response.ok) {
            currentUser = data;
            const navUsername = document.getElementById('navUsername');
            const previewUsername = document.getElementById('previewUsername');
            if (navUsername) navUsername.textContent = data.username;
            if (previewUsername) previewUsername.textContent = data.instagram_username || data.username;
            
            // Don't call navigateTo here, let handleRoute manage it
            const navbar = document.getElementById('navbar');
            if (navbar) navbar.style.display = 'flex';
        } else {
            localStorage.removeItem('access_token');
            navigateTo('/login');
        }
    } catch (error) {
        localStorage.removeItem('access_token');
        navigateTo('/login');
    }
}

// Dashboard Functions
async function loadDashboard() {
    // Check if dashboard elements are currently visible before trying to load
    if (!document.getElementById('dashboardView')) {
        // Dashboard not currently loaded, skip
        return;
    }
    
    // Add delay to ensure DOM is fully ready and elements are accessible
    await new Promise(resolve => setTimeout(resolve, 50));
    
    await checkInstagramStatus();
    await loadStats();
    await loadUpcomingPosts();
}

async function checkInstagramStatus() {
    try {
        const igNotConnected = document.getElementById('igNotConnected');
        const igConnected = document.getElementById('igConnected');
        const igUsername = document.getElementById('igUsername');
        const igExpiry = document.getElementById('igExpiry');
        
        if (!igNotConnected || !igConnected) {
            console.error('Instagram status elements not found');
            return;
        }
        
        // Try to load from cache first
        const cachedStatus = localStorage.getItem('dashboard_ig_status');
        if (cachedStatus) {
            try {
                const cached = JSON.parse(cachedStatus);
                if (cached.connected) {
                    igNotConnected.style.display = 'none';
                    igConnected.style.display = 'block';
                    if (igUsername) igUsername.textContent = cached.instagram_username;
                    if (igExpiry) igExpiry.textContent = new Date(cached.token_expires_at).toLocaleDateString();
                } else {
                    igNotConnected.style.display = 'block';
                    igConnected.style.display = 'none';
                }
            } catch (e) {
                console.warn('Failed to parse cached status:', e);
            }
        }
        
        // Update from server in background
        const response = await apiCall('/instagram/status');
        const data = await response.json();
        
        // Cache the result
        localStorage.setItem('dashboard_ig_status', JSON.stringify(data));
        
        if (data.connected) {
            igNotConnected.style.display = 'none';
            igConnected.style.display = 'block';
            if (igUsername) igUsername.textContent = data.instagram_username;
            if (igExpiry) igExpiry.textContent = new Date(data.token_expires_at).toLocaleDateString();
        } else {
            igNotConnected.style.display = 'block';
            igConnected.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to check Instagram status:', error);
    }
}

async function loadStats() {
    try {
        const statTotal = document.getElementById('statTotal');
        const statScheduled = document.getElementById('statScheduled');
        const statPublished = document.getElementById('statPublished');
        const statFailed = document.getElementById('statFailed');
        
        if (!statTotal || !statScheduled || !statPublished || !statFailed) {
            console.error('Stats elements not found');
            return;
        }
        
        // Try to load from cache first
        const cachedStats = localStorage.getItem('dashboard_stats');
        if (cachedStats) {
            try {
                const cached = JSON.parse(cachedStats);
                statTotal.textContent = cached.total_posts;
                statScheduled.textContent = cached.scheduled;
                statPublished.textContent = cached.published;
                statFailed.textContent = cached.failed;
            } catch (e) {
                console.warn('Failed to parse cached stats:', e);
            }
        }
        
        // Update from server (don't wait for this, let it happen in background)
        const response = await apiCall('/users/stats');
        const data = await response.json();
        
        // Cache the result
        localStorage.setItem('dashboard_stats', JSON.stringify(data));
        
        statTotal.textContent = data.total_posts;
        statScheduled.textContent = data.scheduled;
        statPublished.textContent = data.published;
        statFailed.textContent = data.failed;
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

async function loadUpcomingPosts() {
    try {
        const container = document.getElementById('upcomingPostsContainer');
        
        if (!container) {
            console.error('Upcoming posts container not found');
            return;
        }
        
        // Try to load from cache first (don't reset container, just update it)
        const cachedUpcoming = localStorage.getItem('dashboard_upcoming_posts');
        if (cachedUpcoming) {
            try {
                const cached = JSON.parse(cachedUpcoming);
                if (cached.posts && cached.posts.length > 0) {
                    container.innerHTML = cached.posts.map(post => `
                        <div class="upcoming-post">
                            ${post.media && post.media.length > 0 ? `
                                <img src="/api/posts/media/${post.media[0].id}" 
                                     class="upcoming-post-thumbnail" 
                                     alt="Post thumbnail">
                            ` : ''}
                            <div class="upcoming-post-info">
                                <div class="upcoming-post-time">
                                    ${formatDateTime(post.scheduled_time)}
                                </div>
                                <div class="upcoming-post-caption">
                                    ${post.caption || 'No caption'}
                                </div>
                            </div>
                        </div>
                    `).join('');
                } else {
                    container.innerHTML = '<p class="text-muted">No upcoming posts scheduled.</p>';
                }
            } catch (e) {
                console.warn('Failed to parse cached upcoming posts:', e);
            }
        }
        
        // Update from server (don't wait for this)
        const response = await apiCall('/posts/upcoming');
        const data = await response.json();
        
        // Cache the result
        localStorage.setItem('dashboard_upcoming_posts', JSON.stringify(data));
        
        if (data.posts.length === 0) {
            container.innerHTML = '<p class="text-muted">No upcoming posts scheduled.</p>';
            return;
        }
        
        container.innerHTML = data.posts.map(post => `
            <div class="upcoming-post">
                ${post.media.length > 0 ? `
                    <img src="/api/posts/media/${post.media[0].id}" 
                         class="upcoming-post-thumbnail" 
                         alt="Post thumbnail">
                ` : ''}
                <div class="upcoming-post-info">
                    <div class="upcoming-post-time">
                        ${formatDateTime(post.scheduled_time)}
                    </div>
                    <div class="upcoming-post-caption">
                        ${post.caption || 'No caption'}
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load upcoming posts:', error);
    }
}

// Posts Functions - Combined View
async function loadAllPosts() {
    const container = document.getElementById('postsContainer');
    const loading = document.getElementById('postsLoading');
    const statusFilterEl = document.getElementById('statusFilter');
    
    if (!container || !loading || !statusFilterEl) {
        console.error('Posts view elements not found');
        return;
    }
    
    const statusFilter = statusFilterEl.value;
    
    loading.style.display = 'block';
    container.innerHTML = '';
    
    try {
        let allPosts = [];
        let fromCache = false;
        
        // Load PostWave posts
        if (statusFilter !== 'instagram') {
            const params = statusFilter ? `?status=${statusFilter}` : '';
            const response = await apiCall(`/posts/${params}`);
            const data = await response.json();
            allPosts = data.posts.map(post => ({
                ...post,
                source: 'postwave',
                sortTime: new Date(post.scheduled_time || post.created_at)
            }));
        }
        
        // Load Instagram posts with caching
        if (!statusFilter || statusFilter === 'instagram' || statusFilter === 'published') {
            try {
                const igResponse = await apiCall('/instagram/posts?limit=25');
                const igData = await igResponse.json();
                fromCache = igData.from_cache || false;
                
                // Cache posts on client side with encryption
                if (encryptionKey && igData.posts && typeof EncryptedCacheManager !== 'undefined') {
                    try {
                        await EncryptedCacheManager.cachePostsBatch(igData.posts, encryptionKey);
                    } catch (e) {
                        console.warn('Failed to cache posts locally:', e);
                    }
                }
                
                // Get list of instagram_post_ids from PostWave posts to avoid duplicates
                const postwaveInstagramIds = allPosts
                    .filter(p => p.instagram_post_id)
                    .map(p => p.instagram_post_id);
                
                // Filter out Instagram posts that are already in PostWave
                const igPosts = igData.posts
                    .filter(post => !postwaveInstagramIds.includes(post.id))
                    .map(post => {
                        const imageUrl = post.cached_image_url || post.media_url;
                        return {
                            id: post.id,
                            caption: post.caption,
                            media: [{ id: post.id, url: imageUrl, original_url: post.media_url }],
                            status: 'published',
                            published_at: post.timestamp,
                            permalink: post.permalink,
                            source: 'instagram',
                            sortTime: new Date(post.timestamp)
                        };
                    });
                allPosts = [...allPosts, ...igPosts];
            } catch (igError) {
                console.log('Could not load Instagram posts:', igError);
            }
        }
        
        // Sort by time (most recent first)
        allPosts.sort((a, b) => b.sortTime - a.sortTime);
        
        loading.style.display = 'none';
        
        if (allPosts.length === 0) {
            container.innerHTML = '<p class="text-muted">No posts found.</p>';
            return;
        }
        
        // Add cache note if showing Instagram posts
        let cacheNote = '';
        if (fromCache && (!statusFilter || statusFilter === 'instagram' || statusFilter === 'published')) {
            cacheNote = `<div class="cache-info" style="padding: 0.75rem; margin-bottom: 1rem; background: #E0F2FE; border-left: 4px solid #0284C7; border-radius: 4px; grid-column: 1 / -1;">
                <span style="color: #0C4A6E; font-size: 0.875rem;">📦 Instagram posts loaded from cache (updated ${new Date().toLocaleTimeString()})</span>
            </div>`;
        }
        
        container.innerHTML = cacheNote + allPosts.map(post => {
            const isInstagram = post.source === 'instagram';
            const cardClass = isInstagram ? 'post-card-instagram' : `post-card-${post.status}`;
            
            return `
                <div class="post-card ${cardClass}">
                    ${post.media && post.media.length > 0 ? `
                        <img src="${isInstagram ? post.media[0].url : `/api/posts/media/${post.media[0].id}`}" 
                             class="post-thumbnail" 
                             alt="Post thumbnail"
                             onerror="this.src='${isInstagram ? post.media[0].original_url : ''}'">
                    ` : ''}
                    <div class="post-content">
                        <div class="post-caption">
                            <div class="post-caption-text">
                                ${post.caption || 'No caption'}
                            </div>
                            <div class="post-indicators">
                                ${post.status === 'published' && post.instagram_post_id ? '<div class="post-indicator indicator-postwave" title="Published by PostWave">✓</div>' : ''}
                                ${post.status === 'failed' ? '<div class="post-indicator indicator-failed" title="Failed to publish">!</div>' : ''}
                            </div>
                        </div>
                        <div class="post-meta">
                            <span>${formatDateTime(post.scheduled_time || post.published_at)}</span>
                            <span class="post-status status-${post.status}">${post.status}</span>
                        </div>
                        <div class="post-actions">
                            ${isInstagram ? `
                                <a href="${post.permalink}" target="_blank" class="btn btn-sm btn-secondary">
                                    View
                                </a>
                            ` : `
                                <button class="btn btn-sm btn-secondary" onclick="viewPost(${post.id})">
                                    View
                                </button>
                                ${post.status !== 'published' ? `
                                    <button class="btn btn-sm btn-danger" onclick="deletePost(${post.id})">
                                        Delete
                                    </button>
                                ` : ''}
                            `}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        loading.style.display = 'none';
        console.error('Failed to load posts:', error);
        container.innerHTML = '<p class="text-muted">Failed to load posts. Please try again.</p>';
    }
}

async function loadPosts() {
    // Kept for backward compatibility
    return loadAllPosts();
}

async function viewPost(postId) {
    try {
        const response = await apiCall(`/posts/${postId}`);
        const post = await response.json();
        
        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div>
                    <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Status</div>
                    <span class="post-status status-${post.status}">${post.status.toUpperCase()}</span>
                </div>
                
                <div>
                    <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Scheduled Time</div>
                    <div>${formatDateTime(post.scheduled_time)}</div>
                </div>
                
                ${post.published_at ? `
                    <div>
                        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Published At</div>
                        <div>${formatDateTime(post.published_at)}</div>
                    </div>
                ` : ''}
                
                <div>
                    <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Caption</div>
                    <div style="white-space: pre-wrap; line-height: 1.6;">${post.caption || 'No caption'}</div>
                </div>
                
                <div>
                    <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Media (${post.media.length})</div>
                    <div class="media-preview">
                        ${post.media.map(m => `
                            <img src="/api/posts/media/${m.id}" alt="Media">
                        `).join('')}
                    </div>
                </div>
                
                ${post.error_message ? `
                    <div class="alert-error" style="padding: 1rem; border-radius: 0.5rem; background: #FEE2E2; border: 1px solid #EF4444; color: #991B1B;">
                        <div style="font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                            <div class="post-indicator indicator-failed">!</div>
                            Error Details
                        </div>
                        <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-size: 0.875rem; background: rgba(0,0,0,0.05); padding: 0.75rem; border-radius: 0.375rem; font-family: monospace;">${post.error_message}</pre>
                    </div>
                ` : ''}
            </div>
        `;
        
        document.getElementById('postModal').classList.add('show');
    } catch (error) {
        showToast('Failed to load post details', 'error');
    }
}

async function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post?')) {
        return;
    }
    
    try {
        const response = await apiCall(`/posts/${postId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Post deleted successfully', 'success');
            loadPosts();
            loadDashboard();
        } else {
            showToast('Failed to delete post', 'error');
        }
    } catch (error) {
        showToast('Failed to delete post', 'error');
    }
}

// Instagram Posts Functions
async function loadInstagramPosts() {
    const container = document.getElementById('instagramPostsContainer');
    const loading = document.getElementById('instagramPostsLoading');
    const error = document.getElementById('instagramPostsError');
    const empty = document.getElementById('instagramPostsEmpty');
    const refreshBtn = document.getElementById('refreshInstagramPosts');
    
    // Reset states
    container.innerHTML = '';
    loading.style.display = 'block';
    error.style.display = 'none';
    empty.style.display = 'none';
    if (refreshBtn) refreshBtn.disabled = true;
    
    try {
        // Check if refresh was requested
        const forceRefresh = refreshBtn && refreshBtn.dataset.forceRefresh === 'true';
        if (forceRefresh) {
            delete refreshBtn.dataset.forceRefresh;
        }
        
        const url = `/api/instagram/posts?limit=25${forceRefresh ? '&refresh=true' : ''}`;
        const response = await apiCall(url);
        const data = await response.json();
        
        loading.style.display = 'none';
        if (refreshBtn) refreshBtn.disabled = false;
        
        if (!response.ok) {
            error.textContent = data.error || 'Failed to load Instagram posts';
            error.style.display = 'block';
            return;
        }
        
        if (!data.posts || data.posts.length === 0) {
            empty.style.display = 'block';
            return;
        }
        
        // Cache posts on client side with encryption
        if (encryptionKey && typeof EncryptedCacheManager !== 'undefined') {
            try {
                await EncryptedCacheManager.cachePostsBatch(data.posts, encryptionKey);
            } catch (e) {
                console.warn('Failed to cache posts locally:', e);
            }
        }
        
        // Show cache info if data came from cache
        let cacheNote = '';
        if (data.from_cache) {
            cacheNote = `<div class="cache-info" style="padding: 0.75rem; margin-bottom: 1rem; background: #E0F2FE; border-left: 4px solid #0284C7; border-radius: 4px;">
                <span style="color: #0C4A6E; font-size: 0.875rem;">📦 Loaded from cache (updated ${new Date().toLocaleTimeString()})</span>
            </div>`;
        }
        
        container.innerHTML = cacheNote + data.posts.map(post => {
            const imageUrl = post.cached_image_url || post.media_url;
            return `
                <div class="post-card">
                    ${post.media_type === 'VIDEO' ? `
                        <video class="post-thumbnail" controls>
                            <source src="${post.media_url}" type="video/mp4">
                        </video>
                    ` : `
                        <img src="${imageUrl}" 
                             class="post-thumbnail" 
                             alt="Instagram post"
                             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22%3EImage%3C/text%3E%3C/svg%3E'">
                    `}
                    <div class="post-content">
                        <div class="post-caption">
                            ${post.caption ? post.caption.substring(0, 150) + (post.caption.length > 150 ? '...' : '') : 'No caption'}
                        </div>
                        <div class="post-meta">
                            <span>📅 ${formatDateTime(post.timestamp)}</span>
                            ${post.like_count !== undefined ? `<span>❤️ ${post.like_count}</span>` : ''}
                            ${post.comments_count !== undefined ? `<span>💬 ${post.comments_count}</span>` : ''}
                        </div>
                        <div class="post-actions">
                            <a href="${post.permalink}" target="_blank" class="btn btn-sm btn-primary">
                                View on Instagram
                            </a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to load Instagram posts:', error);
        loading.style.display = 'none';
        if (refreshBtn) refreshBtn.disabled = false;
        error.textContent = 'Failed to load Instagram posts. Please try again.';
        error.style.display = 'block';
    }
}

// Refresh Instagram posts with force fetch
async function refreshInstagramPosts() {
    const refreshBtn = document.getElementById('refreshInstagramPosts');
    if (!refreshBtn) return;
    
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';
    
    try {
        const response = await apiCall('/api/instagram/refresh-cache', { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            // Update local cache
            if (encryptionKey && data.posts && typeof EncryptedCacheManager !== 'undefined') {
                try {
                    await EncryptedCacheManager.cachePostsBatch(data.posts, encryptionKey);
                } catch (e) {
                    console.warn('Failed to update local cache:', e);
                }
            }
            
            showToast('Instagram posts refreshed successfully', 'success');
            await loadInstagramPosts();
        } else {
            showToast(data.error || 'Failed to refresh posts', 'error');
        }
    } catch (error) {
        console.error('Refresh failed:', error);
        showToast('Failed to refresh posts', 'error');
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
        }
    }
}


// New Post Functions
async function handleMediaSelect(e) {
    const files = Array.from(e.target.files);
    
    if (files.length > 20) {
        showToast('Maximum 20 images allowed', 'error');
        e.target.value = '';
        return;
    }
    
    // Process images (resize if needed)
    const processedFiles = [];
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            try {
                const processed = await processImage(file);
                processedFiles.push(processed);
                
                // Show resize notification if file was resized
                if (processed.size !== file.size) {
                    showToast(`Image "${file.name}" was optimized for Instagram`, 'info');
                }
            } catch (error) {
                console.error('Failed to process image:', error);
                processedFiles.push(file);
            }
        } else {
            processedFiles.push(file);
        }
    }
    
    selectedFiles = processedFiles;
    displayMediaPreview();
    updatePreview();
}

function displayMediaPreview() {
    const container = document.getElementById('mediaPreview');
    container.innerHTML = '';
    
    selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = 'media-preview-item';
            div.innerHTML = `
                <img src="${e.target.result}" alt="Preview ${index + 1}">
                <button class="media-preview-remove" onclick="removeMedia(${index})">&times;</button>
            `;
            container.appendChild(div);
        };
        reader.readAsDataURL(file);
    });
}

function removeMedia(index) {
    selectedFiles.splice(index, 1);
    displayMediaPreview();
    updatePreview();
}

function updatePreview() {
    const caption = document.getElementById('postCaption').value;
    const selectedDate = document.querySelector('.week-calendar-day.selected');
    const timePeriod = document.getElementById('timePeriod').value;
    const scheduledTimeInput = document.getElementById('scheduledTime').value;
    
    // Update caption preview
    document.getElementById('previewCaption').textContent = caption || 'Your caption will appear here...';
    
    // Update character count
    document.getElementById('captionCount').textContent = caption.length;
    
    // Update date and time preview
    const previewDate = document.getElementById('previewDate');
    let scheduledDateTime = null;
    
    // Check if manual datetime is set, otherwise use calendar + time period
    if (scheduledTimeInput) {
        scheduledDateTime = new Date(scheduledTimeInput);
    } else if (selectedDate && timePeriod) {
        const dateStr = selectedDate.getAttribute('data-date');
        scheduledDateTime = getScheduledDateTime(dateStr, timePeriod);
    }
    
    if (scheduledDateTime) {
        const formattedDate = formatDateTime(scheduledDateTime.toISOString());
        previewDate.textContent = `Scheduled: ${formattedDate}`;
    } else {
        previewDate.textContent = 'Scheduled: --';
    }
    
    // Update images preview
    const previewContainer = document.getElementById('previewImages');
    previewContainer.innerHTML = '';
    
    if (selectedFiles.length > 0) {
        selectedFiles.forEach((file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.createElement('img');
                img.src = e.target.result;
                previewContainer.appendChild(img);
            };
            reader.readAsDataURL(file);
        });
    }
}

// Initialize week calendar with 7 days
function initializeWeekCalendar() {
    const calendar = document.getElementById('weekCalendar');
    if (!calendar) return;
    
    calendar.innerHTML = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculate the start of the week to display based on offset
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() + (calendarWeekOffset * 7));
    
    // Update month display
    const monthDisplay = document.getElementById('weekMonthDisplay');
    if (monthDisplay) {
        const monthName = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        monthDisplay.textContent = monthName;
    }
    
    // Get scheduled posts for this week to show indicators
    getScheduledPostsForWeek().then(scheduledPosts => {
        for (let i = 0; i < 7; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            
            const dateStr = date.toISOString().split('T')[0];
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNum = date.getDate();
            const monthName = date.toLocaleDateString('en-US', { month: 'short' });
            
            // Check if date has passed
            const isPast = date < today;
            
            // Check if there are posts scheduled for this day
            const postsForDay = scheduledPosts.filter(post => {
                const postDate = new Date(post.scheduled_time).toISOString().split('T')[0];
                return postDate === dateStr;
            });
            
            const dayDiv = document.createElement('div');
            dayDiv.className = 'week-calendar-day';
            if (isPast) {
                dayDiv.classList.add('disabled');
            }
            dayDiv.setAttribute('data-date', dateStr);
            dayDiv.innerHTML = `
                <div class="day-name">${dayName}</div>
                <div class="day-number">${dayNum}</div>
                <div class="month-name">${monthName}</div>
                ${postsForDay.length > 0 ? `<div class="scheduled-count">${postsForDay.length}</div>` : ''}
            `;
            
            if (!isPast) {
                dayDiv.addEventListener('click', () => selectCalendarDay(dayDiv));
            }
            calendar.appendChild(dayDiv);
        }
    });
}

function navigateWeek(direction) {
    calendarWeekOffset += direction;
    initializeWeekCalendar();
}

function selectCalendarDay(dayElement) {
    // Remove selection from all days
    const allDays = document.querySelectorAll('.week-calendar-day');
    allDays.forEach(day => day.classList.remove('selected'));
    
    // Add selection to clicked day
    dayElement.classList.add('selected');
    
    // Update datetime input with the selected date if time period is selected
    const timePeriod = document.getElementById('timePeriod').value;
    if (timePeriod) {
        const dateStr = dayElement.getAttribute('data-date');
        const scheduledDateTime = getScheduledDateTime(dateStr, timePeriod);
        updateDateTimeInput(scheduledDateTime);
    }
    
    updatePreview();
}

function handleTimePeriodChange(e) {
    const timePeriod = e.target.value;
    const selectedDate = document.querySelector('.week-calendar-day.selected');
    
    // If a date is selected and a time period is chosen, update the datetime input
    if (selectedDate && timePeriod) {
        const dateStr = selectedDate.getAttribute('data-date');
        const scheduledDateTime = getScheduledDateTime(dateStr, timePeriod);
        updateDateTimeInput(scheduledDateTime);
    }
    
    updatePreview();
}

function updateDateTimeInput(dateTime) {
    const scheduledTime = document.getElementById('scheduledTime');
    if (scheduledTime) {
        const year = dateTime.getFullYear();
        const month = String(dateTime.getMonth() + 1).padStart(2, '0');
        const day = String(dateTime.getDate()).padStart(2, '0');
        const hours = String(dateTime.getHours()).padStart(2, '0');
        const minutes = String(dateTime.getMinutes()).padStart(2, '0');
        scheduledTime.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
}

function handleManualDateTimeChange(e) {
    const scheduledTime = e.target.value;
    if (!scheduledTime) return;
    
    const dateTime = new Date(scheduledTime);
    const dateStr = dateTime.toISOString().split('T')[0];
    
    // Update calendar selection
    const allDays = document.querySelectorAll('.week-calendar-day');
    allDays.forEach(day => day.classList.remove('selected'));
    
    const targetDay = document.querySelector(`.week-calendar-day[data-date="${dateStr}"]`);
    if (targetDay) {
        targetDay.classList.add('selected');
    }
    
    // Determine time period from the hour (match closest time)
    const hour = dateTime.getHours();
    let timePeriod = '';
    
    // Find closest time period
    const times = { morning: 9, afternoon: 12, evening: 17, night: 20 };
    let closestPeriod = '';
    let closestDiff = Infinity;
    
    for (const [period, periodHour] of Object.entries(times)) {
        const diff = Math.abs(hour - periodHour);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestPeriod = period;
        }
    }
    
    if (closestPeriod) {
        document.getElementById('timePeriod').value = closestPeriod;
    }
    
    updatePreview();
}

function getScheduledDateTime(dateStr, timePeriod) {
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, parseInt(month) - 1, parseInt(day));
    
    const timeMap = {
        'morning': 9,        // 9:00 AM
        'afternoon': 12,     // 12:00 PM
        'evening': 17,       // 5:00 PM
        'night': 20          // 8:00 PM
    };
    
    const hour = timeMap[timePeriod];
    if (hour === undefined) return date;
    
    date.setHours(hour, 0, 0, 0);
    return date;
}

async function getScheduledPostsForWeek() {
    try {
        const response = await apiCall('/posts/', {
            method: 'GET',
        });
        
        if (response.ok) {
            const data = await response.json();
            // Filter for scheduled posts only
            const posts = Array.isArray(data) ? data : (data.posts || []);
            return posts.filter(post => post.status === 'scheduled');
        }
    } catch (error) {
        console.error('Failed to fetch scheduled posts:', error);
    }
    return [];
}

async function handleCreatePost(e, status = 'scheduled') {
    if (e) e.preventDefault();
    
    const caption = document.getElementById('postCaption').value;
    const selectedDate = document.querySelector('.week-calendar-day.selected');
    const timePeriod = document.getElementById('timePeriod').value;
    const scheduledTimeInput = document.getElementById('scheduledTime').value;
    
    if (selectedFiles.length === 0) {
        showToast('Please select at least one image', 'error');
        return;
    }
    
    let scheduledDateTime = null;
    
    // Use manual datetime input if provided, otherwise use calendar + time period
    if (scheduledTimeInput) {
        scheduledDateTime = new Date(scheduledTimeInput);
    } else if (selectedDate && timePeriod) {
        const dateStr = selectedDate.getAttribute('data-date');
        scheduledDateTime = getScheduledDateTime(dateStr, timePeriod);
    } else {
        showToast('Please select a date and time', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('caption', caption);
    formData.append('scheduled_time', scheduledDateTime.toISOString());
    formData.append('status', status);
    
    selectedFiles.forEach((file) => {
        formData.append('media', file);
    });
    
    try {
        const response = await apiCall('/posts/', {
            method: 'POST',
            body: formData,
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast(`Post ${status === 'draft' ? 'saved as draft' : 'scheduled'} successfully!`, 'success');
            resetPostForm();
            navigateTo('/dashboard');
        } else {
            showToast(data.error || 'Failed to create post', 'error');
        }
    } catch (error) {
        showToast('Failed to create post', 'error');
    }
}

function resetPostForm() {
    const form = document.getElementById('newPostForm');
    const mediaPreview = document.getElementById('mediaPreview');
    const previewImages = document.getElementById('previewImages');
    const previewCaption = document.getElementById('previewCaption');
    const previewDate = document.getElementById('previewDate');
    const captionCount = document.getElementById('captionCount');
    const timePeriod = document.getElementById('timePeriod');
    const scheduledTime = document.getElementById('scheduledTime');
    
    if (form) form.reset();
    selectedFiles = [];
    if (mediaPreview) mediaPreview.innerHTML = '';
    if (previewImages) previewImages.innerHTML = '';
    if (previewCaption) previewCaption.textContent = 'Your caption will appear here...';
    if (previewDate) previewDate.textContent = 'Scheduled: --';
    if (captionCount) captionCount.textContent = '0';
    if (timePeriod) timePeriod.value = '';
    if (scheduledTime) scheduledTime.value = '';
    
    // Reset calendar selection only (don't reinitialize)
    const selectedDays = document.querySelectorAll('.week-calendar-day.selected');
    selectedDays.forEach(day => day.classList.remove('selected'));
}

function initializeNewPostView() {
    // Initialize the new post form on first load
    // Do not reinitialize calendar - it's already initialized in setupViewListeners()
}

// Instagram Functions
async function connectInstagram(e) {
    e.preventDefault();
    
    const accessToken = document.getElementById('accessToken').value;
    const instagramAccountId = document.getElementById('instagramAccountId').value;
    const pageId = document.getElementById('pageId').value;
    
    if (!accessToken) {
        showToast('Access Token is required', 'error');
        return;
    }
    
    if (!instagramAccountId && !pageId) {
        showToast('Please provide either Instagram Account ID or Page ID', 'error');
        return;
    }
    
    try {
        console.log('=== INSTAGRAM CONNECTION START ===');
        console.log('Access Token:', accessToken.substring(0, 20) + '...');
        console.log('Instagram Account ID:', instagramAccountId || 'Not provided');
        console.log('Page ID:', pageId || 'Not provided');
        
        const requestBody = {
            access_token: accessToken
        };
        
        if (instagramAccountId) {
            requestBody.instagram_account_id = instagramAccountId;
        } else {
            requestBody.page_id = pageId;
        }
        
        const response = await apiCall('/instagram/connect', {
            method: 'POST',
            body: JSON.stringify(requestBody),
        });
        
        const data = await response.json();
        console.log('API Response Status:', response.status);
        console.log('API Response Data:', data);
        
        if (response.ok) {
            showToast(`✅ Instagram connected successfully! @${data.instagram_username}`, 'success');
            document.getElementById('instagramConfigForm').reset();
            loadDashboard();
        } else {
            // Get error message
            let errorMsg = data.error || data.message || 'Failed to connect Instagram (no error details)';
            let errorDetails = data.details || '';
            
            console.error('❌ Connection Error:', errorMsg);
            console.error('Error Details:', errorDetails);
            
            // Show error in modal for better visibility
            showErrorModal(
                'Instagram Connection Failed',
                errorMsg,
                errorDetails
            );
        }
    } catch (error) {
        console.error('❌ Connection Exception:', error);
        console.error('Error Stack:', error.stack);
        showErrorModal(
            'Connection Error',
            error.message || 'An unexpected error occurred',
            'Check the browser console (F12) for more details'
        );
    }
}

// Show detailed error in a modal
function showErrorModal(title, errorMsg, details) {
    const modalBody = document.getElementById('modalBody');
    
    let detailsHtml = '';
    if (details) {
        detailsHtml = `
            <div style="margin-top: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 4px; border-left: 4px solid #dc3545;">
                <strong>Technical Details:</strong>
                <pre style="margin-top: 0.5rem; font-size: 0.85rem; overflow-x: auto;">${details}</pre>
            </div>
        `;
    }
    
    let troubleshootingHtml = '';
    if (errorMsg.includes('No Instagram Business Account')) {
        troubleshootingHtml = `
            <div style="margin-top: 1rem; padding: 1rem; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ffc107;">
                <strong>💡 Troubleshooting Steps:</strong>
                <ol style="margin: 0.5rem 0 0 1rem;">
                    <li>Open Instagram → Settings → Account</li>
                    <li>Verify you're on a <strong>Business Account</strong> (not Personal)</li>
                    <li>Go to Settings → Linked Accounts</li>
                    <li>Make sure your Facebook Page is linked</li>
                    <li>Generate a new token and try again</li>
                </ol>
            </div>
        `;
    } else if (errorMsg.includes('Invalid') || errorMsg.includes('invalid')) {
        troubleshootingHtml = `
            <div style="margin-top: 1rem; padding: 1rem; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ffc107;">
                <strong>💡 Troubleshooting Steps:</strong>
                <ol style="margin: 0.5rem 0 0 1rem;">
                    <li>The Access Token may be <strong>expired</strong> (expires in 60 days)</li>
                    <li>Go to <a href="https://developers.facebook.com/tools/accesstoken/" target="_blank">Access Token Tool</a></li>
                    <li>Generate a <strong>new token</strong></li>
                    <li>Verify these permissions are checked:
                        <ul>
                            <li>instagram_basic</li>
                            <li>instagram_content_publish</li>
                            <li>pages_read_engagement</li>
                        </ul>
                    </li>
                    <li>Copy the new token and try again</li>
                </ol>
            </div>
        `;
    }
    
    modalBody.innerHTML = `
        <div style="color: #dc3545; margin-bottom: 1rem;">
            <h3>${title}</h3>
            <p style="font-size: 1rem; margin: 0.5rem 0;">${errorMsg}</p>
        </div>
        ${troubleshootingHtml}
        ${detailsHtml}
        <div style="margin-top: 1.5rem;">
            <small style="color: #666;">💻 Tip: Press F12 to open browser console for more debug information</small>
        </div>
    `;
    
    document.getElementById('postModal').classList.add('show');
}

async function disconnectInstagram() {
    if (!confirm('Are you sure you want to disconnect Instagram?')) {
        return;
    }
    
    try {
        const response = await apiCall('/instagram/disconnect', {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Instagram disconnected', 'info');
            loadDashboard();
        } else {
            showToast('Failed to disconnect Instagram', 'error');
        }
    } catch (error) {
        showToast('Failed to disconnect Instagram', 'error');
    }
}

// Settings Functions
async function changePassword(e) {
    e.preventDefault();
    
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    
    try {
        const response = await apiCall('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword
            }),
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Password changed successfully', 'success');
            document.getElementById('changePasswordForm').reset();
        } else {
            showToast(data.error || 'Failed to change password', 'error');
        }
    } catch (error) {
        showToast('Failed to change password', 'error');
    }
}

// Utility Functions
function formatDateTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

function closeModal() {
    document.getElementById('postModal').classList.remove('show');
}
