// API Configuration
const API_BASE = '/api';

// State
let currentUser = null;
let userProfileData = null; // Cache for profile picture and Instagram username
let selectedFiles = [];
let currentTheme = localStorage.getItem('theme') || 'light';
let navbarListenersSetup = false; // Track if navbar listeners are already set up
let calendarWeekOffset = 0; // Track which week is being displayed (0 = current week)
let calendarInitialized = false; // Track if calendar has been initialized for this view
let currentCarouselIndex = 0; // Track current image in carousel
let selectedAspectRatio = 'original'; // ASPECT RATIO FEATURE DISABLED - Defaulted to 'original'
let draggedItemIndex = null; // Track dragged item during reordering
let currentCropIndex = null; // Track which image is being cropped
let cropData = {}; // Store crop data for images
let invitationToken = null; // Store invitation token from URL query parameter
let invitationDetailsLoaded = false; // Track if invitation details have been loaded

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
    // Remove leading slash
    const fullPath = path.replace(/^\//, '');
    // Get path without query params
    const cleanPath = fullPath.split('?')[0] || '';
    
    // Extract and store invitation token if present in URL
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        invitationToken = urlToken;
        console.log('Invitation token extracted from URL:', invitationToken);
    }
    
    const token = localStorage.getItem('access_token');
    
    console.log('handleRoute called with path:', path, 'cleanPath:', cleanPath, 'hasToken:', !!token, 'hasInvitationToken:', !!invitationToken);
    
    // Check if this is an accept-invite link
    if (cleanPath.startsWith('accept-invite') && invitationToken) {
        console.log('Processing accept-invite with token');
        // Invitation link - show registration page regardless of auth status
        if (token) {
            // Already logged in, redirect to dashboard
            navigateTo('/dashboard');
        } else {
            loadPageContent('auth', false, true); // Skip auto-setup to prevent double call
            setTimeout(() => {
                console.log('Calling setupAuthListeners for invitation');
                setupAuthListeners();
            }, 200); // Increased timeout to ensure DOM is ready
        }
        return;
    }
    
    // Define route mappings
    const authRoutes = ['login', 'setup'];
    const dashboardRoutes = ['dashboard', 'posts', 'newPost', 'settings', 'teams'];
    
    // Handle root path - check if setup is needed
    if (cleanPath === '') {
        console.log('Root path detected, checking setup status');
        checkSetupStatus().then(needsSetup => {
            console.log('Setup status check result:', needsSetup);
            if (needsSetup) {
                // Setup needed - redirect to setup wizard
                console.log('Navigating to setup page');
                navigateTo('/setup');
            } else if (token) {
                // Setup complete and user logged in - go to dashboard
                console.log('Navigating to dashboard');
                navigateTo('/dashboard');
            } else {
                // Setup complete but not logged in - go to login
                console.log('Navigating to login page');
                navigateTo('/login');
            }
        });
        return;
    }
    
    if (cleanPath === 'setup') {
        // Setup route - only for initial setup
        checkSetupStatus().then(needsSetup => {
            if (needsSetup) {
                loadPageContent('onboarding', false);
                setTimeout(() => {
                    if (onboardingModule) {
                        onboardingModule.init();
                    }
                }, 100);
            } else {
                // Setup already complete, redirect to login

                navigateTo('/login');
            }
        });
    } else if (authRoutes.includes(cleanPath)) {
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

async function checkSetupStatus() {
    /**
     * Check if setup is needed (no super admin exists)
     * Returns true if setup needed, false otherwise
     */
    try {
        const response = await apiCall('/teams/setup-status', {
            method: 'GET',
            skipAuth: true
        });
        
        console.log('Setup status response:', response.status);
        
        // If endpoint returns 200, setup is needed
        if (response.status === 200) {
            console.log('Setup is needed');
            return true;  // Setup needed
        }
        
        // If endpoint returns 400, setup is complete
        if (response.status === 400) {
            console.log('Setup is complete');
            return false;  // Setup complete
        }
        
        // Default: assume setup is done if we get unexpected status
        console.log('Unexpected setup status response:', response.status);
        return false;
    } catch (error) {
        console.error('Error checking setup status:', error);
        // If we can't reach the endpoint, assume setup is NOT done (try setup)
        console.log('Setup status check failed, assuming setup needed');
        return true;  // Assume setup is needed on error
    }
}

// Load page content dynamically from separate HTML files
async function loadPageContent(page, updateUrl = true, skipSetup = false) {
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
            // Setup auth listeners only for auth page (unless skipSetup is true)
            if (page === 'auth' && !skipSetup) {
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
                // Load teams when dropdown is opened
                if (userDropdown.style.display === 'block') {
                    populateTeamSelector();
                }
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
    
    // Teams button
    const navTeams = document.getElementById('navTeams');
    if (navTeams) {
        navTeams.addEventListener('click', () => navigateTo('/teams'));
    }
}

// Populate team selector in dropdown
async function populateTeamSelector() {
    try {
        const response = await apiCall('/teams/teams');
        const data = await response.json();
        
        if (!response.ok) {
            console.error('Failed to fetch teams:', data);
            return;
        }
        
        const teamSelectContainer = document.getElementById('teamSelectContainer');
        if (!teamSelectContainer) return;
        
        const teams = data.teams || [];
        
        // Clear existing team options
        teamSelectContainer.innerHTML = '';
        
        if (teams.length === 0) {
            const noTeams = document.createElement('div');
            noTeams.style.padding = '0.75rem 1rem';
            noTeams.style.color = 'var(--text-secondary)';
            noTeams.style.fontSize = '0.9rem';
            noTeams.textContent = 'No teams found';
            teamSelectContainer.appendChild(noTeams);
            return;
        }
        
        // Get current team from currentUser if available
        const currentTeamId = currentUser?.current_team_id;
        
        teams.forEach(team => {
            const teamOption = document.createElement('button');
            teamOption.className = 'team-option';
            if (team.id === currentTeamId) {
                teamOption.classList.add('active');
            }
            teamOption.innerHTML = `
                <div class="team-option-name">${escapeHtml(team.name)}</div>
                <div class="team-option-member">${team.instagram_username || 'No Instagram connected'}</div>
            `;
            teamOption.addEventListener('click', async () => {
                await switchTeam(team.id);
                // Close dropdown after selecting
                const userDropdown = document.getElementById('userDropdown');
                if (userDropdown) userDropdown.style.display = 'none';
            });
            teamSelectContainer.appendChild(teamOption);
        });
    } catch (error) {
        console.error('Error populating team selector:', error);
    }
}

// Switch to a different team
async function switchTeam(teamId) {
    try {
        // Update current team in user data
        if (currentUser) {
            currentUser.current_team_id = teamId;
        }
        
        // Find the team and update navbar display
        const response = await apiCall(`/teams/teams`);
        const data = await response.json();
        const teams = data.teams || [];
        const selectedTeam = teams.find(t => t.id === teamId);
        
        if (selectedTeam) {
            const navTeamName = document.getElementById('navTeamName');
            if (navTeamName) {
                navTeamName.textContent = selectedTeam.name;
            }
        }
        
        // Refresh current page or reload
        navigateTo(window.location.pathname);
    } catch (error) {
        console.error('Error switching team:', error);
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

// HTML escape function for safe text insertion
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Setup event listeners
// Setup listeners for auth pages (login/register)
function setupAuthListeners() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showRegisterBtn = document.getElementById('showRegister');
    const showLoginBtn = document.getElementById('showLogin');
    
    // New invitation flow listeners
    const acceptInvitationBtn = document.getElementById('acceptInvitationBtn');
    const declineInvitationBtn = document.getElementById('declineInvitationBtn');
    const createAccountForm = document.getElementById('createAccountForm');
    const invitationLoginForm = document.getElementById('invitationLoginForm');
    const proceedToDashboardBtn = document.getElementById('proceedToDashboardBtn');
    
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (acceptInvitationBtn) acceptInvitationBtn.addEventListener('click', handleAcceptInvitation);
    if (declineInvitationBtn) declineInvitationBtn.addEventListener('click', handleDeclineInvitation);
    if (createAccountForm) createAccountForm.addEventListener('submit', handleCreateAccountStep2a);
    if (invitationLoginForm) invitationLoginForm.addEventListener('submit', handleLoginStep2b);
    if (proceedToDashboardBtn) proceedToDashboardBtn.addEventListener('click', handleProceedToTeamDashboard);
    if (showRegisterBtn) showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('/register');
    });
    if (showLoginBtn) showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('/login');
    });
    
    // Check if we have an invitation token
    const token = invitationToken || new URLSearchParams(window.location.search).get('token');
    console.log('setupAuthListeners - checking token. Global invitationToken:', invitationToken, 'URL token:', new URLSearchParams(window.location.search).get('token'), 'final token:', token);
    
    if (token) {
        // Hide login, show invitation form
        const loginPage = document.getElementById('loginPage');
        const invitationPage = document.getElementById('invitationPage');
        console.log('Token found, showing invitation page. loginPage:', !!loginPage, 'invitationPage:', !!invitationPage);
        if (loginPage) loginPage.style.display = 'none';
        if (invitationPage) {
            invitationPage.style.display = 'flex';
            // Only load invitation details once and only if page elements exist
            if (!invitationDetailsLoaded) {
                invitationDetailsLoaded = true;
                loadInvitationDetails(token);
            }
        } else {
            console.error('Invitation page element not found in DOM');
        }
    } else {
        console.log('No token found, showing login page');
        const loginPage = document.getElementById('loginPage');
        const invitationPage = document.getElementById('invitationPage');
        if (loginPage) loginPage.style.display = 'flex';
        if (invitationPage) invitationPage.style.display = 'none';
    }
}

// Setup listeners for view-specific elements
function setupViewListeners() {
    try {
        // Posts view
        const newPostForm = document.getElementById('newPostForm');
        const saveDraftBtn = document.getElementById('saveDraft');
        
        if (newPostForm) newPostForm.addEventListener('submit', handleCreatePost);
        if (saveDraftBtn) saveDraftBtn.addEventListener('click', () => handleCreatePost(null, 'draft'));
        
        // Update profile picture preview when view is shown
        updateProfilePicturePreview();
        
        // Drag and drop
        if (document.getElementById('dropZone')) setupDragAndDrop();
        
        // Media selection
        const mediaFiles = document.getElementById('mediaFiles');
        const postCaption = document.getElementById('postCaption');
        const timePeriod = document.getElementById('timePeriod');
        const scheduledTime = document.getElementById('scheduledTime');
        const prevWeekBtn = document.getElementById('prevWeek');
        const nextWeekBtn = document.getElementById('nextWeek');
        const aspectRatioSelect = document.getElementById('aspectRatio');
        const customAspectInput = document.getElementById('customAspectRatio');
        const carouselPrev = document.getElementById('carouselPrev');
        const carouselNext = document.getElementById('carouselNext');
        
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
        // ASPECT RATIO FEATURE DISABLED - TODO: Fix aspect ratio switching issues
        // if (aspectRatioSelect) aspectRatioSelect.addEventListener('change', handleAspectRatioChange);
        // if (customAspectInput) customAspectInput.addEventListener('change', () => { displayMediaPreview(); updatePreview(); });
        if (carouselPrev) carouselPrev.addEventListener('click', (e) => { e.preventDefault(); navigateCarousel(-1); });
        if (carouselNext) carouselNext.addEventListener('click', (e) => { e.preventDefault(); navigateCarousel(1); });
        
        // Dashboard / Instagram settings
        const connectInstagramBtn = document.getElementById('connectInstagram');
        const disconnectInstagramBtn = document.getElementById('disconnectInstagram');
        const instagramConfigForm = document.getElementById('instagramConfigForm');
        const fetchAccountIdBtn = document.getElementById('fetchAccountIdBtn');
        
        if (connectInstagramBtn) connectInstagramBtn.addEventListener('click', () => navigateTo('/settings'));
        if (disconnectInstagramBtn) disconnectInstagramBtn.addEventListener('click', disconnectInstagram);
        if (instagramConfigForm) instagramConfigForm.addEventListener('submit', connectInstagram);
        if (fetchAccountIdBtn) fetchAccountIdBtn.addEventListener('click', fetchInstagramAccountId);
        
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
    } catch (error) {
        console.error('Error in setupViewListeners:', error);
        // Don't throw - allow view to continue loading even if some listeners fail
    }
}

// Old function - kept for compatibility but should be refactored away
function setupEventListeners() {
    // Auth
    const loginForm = document.getElementById('loginForm');
    
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    
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

// Settings view initialization
async function settingsViewInit() {
    try {
        // Initialize settings UI
        const settingsView = document.getElementById('settings-view');
        if (!settingsView) {
            console.error('Settings view not found');
            return;
        }
        
        // Setup tab switching
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                if (tabName) {
                    // Find the function and call it
                    const fn = window[`switchSettingsTab`];
                    if (fn) fn(tabName);
                }
            });
        });
        
        // Initialize settings after a small delay to ensure currentUser is loaded
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Initialize each tab
        await initializeSettings();
    } catch (error) {
        console.error('Error initializing settings view:', error);
        // Don't throw - allow page to load
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
        'settings': { file: 'settings', nav: 'navSettings', init: null, url: '/settings' },
        'teams': { file: 'teams', nav: null, init: initializeTeamsView, url: '/teams' }
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
        
        // Call view-specific initialization if it exists
        if (view === 'settings') {
            await settingsViewInit();
        }
    } catch (error) {
        console.error('Error loading view:', error);
        document.getElementById('mainContent').innerHTML = '<div style="padding: 2rem; text-align: center;"><p>Error loading view. Please try again.</p></div>';
    }
}

// ============================================
// SETTINGS VIEW FUNCTIONS
// ============================================

async function switchSettingsTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Deactivate all buttons
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const tabElement = document.getElementById(tabName);
    if (tabElement) {
        tabElement.classList.add('active');
    }
    
    // Activate selected button
    const btn = document.querySelector(`[data-tab="${tabName}"]`);
    if (btn) {
        btn.classList.add('active');
    }
}

async function initializeSettings() {
    try {
        // Verify currentUser is available
        if (!currentUser) {
            console.warn('currentUser not yet loaded, retrying...');
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (!currentUser) {
            console.warn('User not authenticated, loading user settings only');
            // Still initialize user settings even if currentUser timing issue
        }
        
        // Initialize user settings first
        await initializeUserSettings().catch(err => {
            console.error('Failed to initialize user settings:', err);
            // Don't throw, allow page to continue
        });
        
        // Check if user is super admin
        const isAdmin = currentUser?.is_super_admin;
        if (isAdmin) {
            const adminTab = document.getElementById('adminSettingsTab');
            if (adminTab) adminTab.style.display = 'block';
            await initializeAdminSettings().catch(err => {
                console.error('Failed to initialize admin settings:', err);
            });
        }
        
        // Check if user is in any team
        if (currentUser?.current_team_id) {
            const teamTab = document.getElementById('teamSettingsTab');
            if (teamTab) teamTab.style.display = 'block';
            await initializeTeamSettings().catch(err => {
                console.error('Failed to initialize team settings:', err);
            });
        }
    } catch (error) {
        console.error('Failed to initialize settings:', error);
        // Don't throw - allow the page to render even if initialization fails
    }
}

async function initializeUserSettings() {
    try {
        // Wait for apiCall to be available
        let attempts = 0;
        while (typeof apiCall === 'undefined' && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (typeof apiCall === 'undefined') {
            throw new Error('apiCall function not available');
        }
        
        const userNameInput = document.getElementById('userNameInput');
        const userEmailInput = document.getElementById('userEmailInput');
        
        if (!userNameInput || !userEmailInput) {
            console.warn('User settings inputs not found');
            return;
        }
        
        console.log('Fetching user profile from /user-settings/profile');
        const response = await apiCall('/user-settings/profile');
        const data = await response.json();
        
        if (response.ok) {
            console.log('Profile data received:', data);
            userNameInput.value = data.name;
            userEmailInput.value = data.email;
        } else {
            console.error('Failed to load profile:', data);
        }
        
        // Setup event listeners
        const saveNameBtn = document.getElementById('saveName');
        const saveEmailBtn = document.getElementById('saveEmail');
        const savePasswordBtn = document.getElementById('savePassword');
        const userLogsRefreshBtn = document.getElementById('userLogsRefresh');
        
        if (saveNameBtn) saveNameBtn.addEventListener('click', saveUserName);
        if (saveEmailBtn) saveEmailBtn.addEventListener('click', saveUserEmail);
        if (savePasswordBtn) savePasswordBtn.addEventListener('click', saveUserPassword);
        if (userLogsRefreshBtn) userLogsRefreshBtn.addEventListener('click', () => loadUserLogs());
        
        // Load user logs
        await loadUserLogs();
    } catch (error) {
        console.error('Failed to initialize user settings:', error);
        // Don't throw, allow page to load with empty forms
    }
}

async function saveUserName() {
    const name = document.getElementById('userNameInput').value.trim();
    
    if (!name) {
        showToast('Name cannot be empty', 'error');
        return;
    }
    
    try {
        const response = await apiCall('/user-settings/profile/name', {
            method: 'PUT',
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Name updated successfully', 'success');
            currentUser.name = name;
            const navUsername = document.getElementById('navUsername');
            if (navUsername) navUsername.textContent = name;
        } else {
            showToast(data.error || 'Failed to update name', 'error');
        }
    } catch (error) {
        console.error('Error saving name:', error);
        showToast('Failed to update name', 'error');
    }
}

async function saveUserEmail() {
    const email = document.getElementById('userEmailInput').value.trim();
    const password = document.getElementById('currentPassword').value;
    
    if (!email) {
        showToast('Email cannot be empty', 'error');
        return;
    }
    
    if (!password) {
        showToast('Current password is required', 'error');
        return;
    }
    
    try {
        const response = await apiCall('/user-settings/profile/email', {
            method: 'PUT',
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Email updated successfully', 'success');
            document.getElementById('currentPassword').value = '';
        } else {
            showToast(data.error || 'Failed to update email', 'error');
        }
    } catch (error) {
        console.error('Error saving email:', error);
        showToast('Failed to update email', 'error');
    }
}

async function saveUserPassword() {
    const currentPassword = document.getElementById('passwordCurrentInput').value;
    const newPassword = document.getElementById('passwordNewInput').value;
    const confirmPassword = document.getElementById('passwordConfirmInput').value;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('All password fields are required', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }
    
    try {
        const response = await apiCall('/user-settings/profile/password', {
            method: 'PUT',
            body: JSON.stringify({ 
                current_password: currentPassword,
                new_password: newPassword,
                confirm_password: confirmPassword
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Password updated successfully', 'success');
            document.getElementById('passwordCurrentInput').value = '';
            document.getElementById('passwordNewInput').value = '';
            document.getElementById('passwordConfirmInput').value = '';
        } else {
            showToast(data.error || 'Failed to update password', 'error');
        }
    } catch (error) {
        console.error('Error saving password:', error);
        showToast('Failed to update password', 'error');
    }
}

async function loadUserLogs() {
    const search = document.getElementById('userLogsSearch')?.value || '';
    
    try {
        const query = new URLSearchParams();
        query.append('page', 1);
        query.append('per_page', 50);
        if (search) query.append('search', search);
        
        const response = await apiCall(`/user-settings/logs?${query}`);
        const data = await response.json();
        
        if (response.ok) {
            renderLogs(data.logs, 'userLogsContainer');
        }
    } catch (error) {
        console.error('Error loading user logs:', error);
    }
}

async function initializeTeamSettings() {
    try {
        if (!currentUser?.current_team_id) {
            console.log('User not in any team');
            return;
        }
        
        const teamId = currentUser.current_team_id;
        const headers = {'Authorization': `Bearer ${localStorage.getItem('access_token')}`};
        
        // Load team info
        console.log('Loading team settings for team:', teamId);
        const teamResponse = await fetch(`/api/team-settings/${teamId}`, { headers });
        if (teamResponse.ok) {
            const teamData = await teamResponse.json();
            // Populate team info section
            const teamNameEl = document.getElementById('teamName');
            const teamDescEl = document.getElementById('teamDescription');
            if (teamNameEl) teamNameEl.textContent = teamData.name;
            if (teamDescEl) teamDescEl.textContent = teamData.description || 'No description';
            
            // Setup team info edit buttons
            const editBtn = document.getElementById('editTeamInfoBtn');
            const saveBtn = document.getElementById('saveTeamInfoBtn');
            const cancelBtn = document.getElementById('cancelTeamInfoBtn');
            
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    document.getElementById('teamInfoDisplay').style.display = 'none';
                    document.getElementById('teamInfoEdit').style.display = 'block';
                    document.getElementById('teamNameInput').value = teamData.name;
                    document.getElementById('teamDescriptionInput').value = teamData.description || '';
                });
            }
            
            if (saveBtn) {
                saveBtn.addEventListener('click', () => saveTeamInfo(teamId, teamData));
            }
            
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    document.getElementById('teamInfoDisplay').style.display = 'block';
                    document.getElementById('teamInfoEdit').style.display = 'none';
                });
            }
            
            // Check Instagram connection status
            loadTeamInstagramStatus(teamId);
        }
        
        // Load team members
        const membersResponse = await fetch(`/api/team-settings/${teamId}/members`, { headers });
        if (membersResponse.ok) {
            const membersData = await membersResponse.json();
            renderTeamMembers(membersData.members);
        }
        
        // Load pending invitations (owner/manager only)
        const invitationsResponse = await fetch(`/api/team-settings/${teamId}/invitations`, { headers });
        if (invitationsResponse.ok) {
            const invData = await invitationsResponse.json();
            renderPendingInvitations(invData.invitations);
        } else if (invitationsResponse.status === 403) {
            // Non-owner/manager, hide invitations section
            const invSection = document.querySelector('[data-section="invitations"]');
            if (invSection) invSection.style.display = 'none';
        }
        
        // Load team logs
        const logsResponse = await fetch(`/api/team-settings/${teamId}/logs?page=1&per_page=50`, { headers });
        if (logsResponse.ok) {
            const logsData = await logsResponse.json();
            renderLogs(logsData.logs, 'teamLogsContainer');
        }
        
        // Setup refresh buttons
        const teamLogsRefreshBtn = document.getElementById('teamLogsRefresh');
        if (teamLogsRefreshBtn) {
            teamLogsRefreshBtn.addEventListener('click', () => loadTeamLogs(teamId));
        }
        
        // Setup Instagram connection button
        const connectBtn = document.getElementById('connectTeamInstagramBtn');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => connectTeamInstagram(teamId));
        }
        
        // Setup invite member button
        const inviteBtn = document.getElementById('inviteMemberBtn');
        if (inviteBtn) {
            inviteBtn.addEventListener('click', () => inviteTeamMember(teamId));
        }
        
    } catch (error) {
        console.error('Error in initializeTeamSettings:', error);
    }
}

async function loadTeamLogs(teamId) {
    try {
        const search = document.getElementById('teamLogsSearch')?.value || '';
        const headers = {'Authorization': `Bearer ${localStorage.getItem('access_token')}`};
        
        const query = new URLSearchParams();
        query.append('page', 1);
        query.append('per_page', 50);
        if (search) query.append('search', search);
        
        const response = await fetch(`/api/team-settings/${teamId}/logs?${query}`, { headers });
        const data = await response.json();
        
        if (response.ok) {
            renderLogs(data.logs, 'teamLogsContainer');
        }
    } catch (error) {
        console.error('Error loading team logs:', error);
    }
}

function renderTeamMembers(members) {
    const container = document.getElementById('teamMembersContainer');
    if (!container) return;
    
    if (!members || members.length === 0) {
        container.innerHTML = '<div class="empty-state">No team members</div>';
        return;
    }
    
    // Find current user's role in the members list
    const currentUserMember = members.find(m => m.id === currentUser?.id);
    const currentUserRole = currentUserMember?.role || currentUser?.team_role;
    
    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            ${members.map(member => {
                const isOwner = currentUserRole === 'owner';
                const isManager = currentUserRole === 'manager';
                const isCurrentUser = member.id === currentUser?.id;
                const canModify = isOwner && !isCurrentUser;
                const canChangeRole = canModify && member.role !== 'owner';
                const canTransferOwnership = isOwner && !isCurrentUser && member.role !== 'owner';
                const canRemove = (isOwner || isManager) && !isCurrentUser;
                
                let actionButtons = '';
                
                if (canChangeRole) {
                    actionButtons += `
                        <button onclick="openRoleChangeModal(${member.user_id}, '${member.name}', '${member.email}')" style="background-color: #2196F3; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">Change Role</button>
                    `;
                }
                
                if (canTransferOwnership) {
                    actionButtons += `
                        <button onclick="openTransferOwnershipModal(${member.user_id}, '${member.name}')" style="background-color: #ff9800; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">Transfer</button>
                    `;
                }
                
                if (canRemove) {
                    actionButtons += `
                        <button onclick="removeMember(${member.user_id})" style="background-color: #f44336; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">Remove</button>
                    `;
                }
                
                return `
                    <tr>
                        <td>${member.name}</td>
                        <td>${member.email}</td>
                        <td><span class="role-badge">${member.role}</span></td>
                        <td style="display: flex; gap: 8px; flex-wrap: wrap;">
                            ${actionButtons || '<span style="color: #999;">-</span>'}
                        </td>
                    </tr>
                `;
            }).join('')}
        </tbody>
    `;
    
    console.log('renderTeamMembers debug:', { currentUserRole, currentUserId: currentUser?.id, membersCount: members.length, members });
    
    container.innerHTML = '';
    container.appendChild(table);
}

function renderPendingInvitations(invitations) {
    const container = document.getElementById('teamInvitationsContainer');
    if (!container) return;
    
    if (!invitations || invitations.length === 0) {
        container.innerHTML = '<div class="empty-state">No pending invitations</div>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Sent Date</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            ${invitations.map(inv => `
                <tr>
                    <td>${inv.email}</td>
                    <td><span class="status-badge">${inv.status}</span></td>
                    <td>${new Date(inv.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="resendInvitation(${inv.id})">Resend</button>
                        <button class="btn btn-sm btn-danger" onclick="cancelInvitation(${inv.id})">Cancel</button>
                    </td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
}

// Store current member being modified for modal operations
let currentModifyingMemberId = null;
let currentModifyingMemberName = null;
let currentModifyingMemberEmail = null;

function openRoleChangeModal(userId, userName, userEmail) {
    console.log('openRoleChangeModal called with:', { userId, userName, userEmail });
    
    if (!userId) {
        console.error('Invalid userId:', userId);
        showToast('Error: Cannot modify this member', 'error');
        return;
    }
    
    currentModifyingMemberId = userId;
    currentModifyingMemberName = userName;
    currentModifyingMemberEmail = userEmail;
    
    const modal = document.getElementById('roleChangeModal');
    const userInfo = document.getElementById('roleChangeUserInfo');
    userInfo.textContent = `Change role for ${userName} (${userEmail})`;
    
    modal.style.display = 'flex';
}

function closeRoleChangeModal() {
    const modal = document.getElementById('roleChangeModal');
    modal.style.display = 'none';
    currentModifyingMemberId = null;
    currentModifyingMemberName = null;
    currentModifyingMemberEmail = null;
}

async function confirmRoleChange(newRole) {
    if (!currentModifyingMemberId) {
        console.error('No member ID to modify');
        return;
    }
    
    // Save the ID before closing modal (since closeModal sets it to null)
    const memberId = currentModifyingMemberId;
    const memberName = currentModifyingMemberName;
    
    closeRoleChangeModal();
    
    try {
        const teamId = currentUser.current_team_id;
        console.log('Changing role for member:', { memberId, teamId, newRole });
        
        const response = await apiCall(`/team-settings/${teamId}/members/${memberId}`, {
            method: 'PUT',
            body: JSON.stringify({ role: newRole })
        });
        
        if (response.ok) {
            showToast(`${memberName}'s role changed to ${newRole} successfully`, 'success');
            // Reload team settings to get updated data
            await initializeTeamSettings();
        } else {
            try {
                const data = await response.json();
                showToast(data.error || 'Failed to change user role', 'error');
            } catch (e) {
                showToast(`Failed to change user role (HTTP ${response.status})`, 'error');
                console.error('Response text:', await response.text());
            }
        }
    } catch (error) {
        console.error('Error changing user role:', error);
        showToast('Failed to change user role', 'error');
    }
}

function openTransferOwnershipModal(userId, userName) {
    const confirmed = confirm(`Are you sure you want to transfer ownership to ${userName}? You will become a manager.`);
    if (!confirmed) return;
    
    transferOwnership(userId);
}

async function transferOwnership(userId) {
    try {
        const teamId = currentUser.current_team_id;
        const response = await apiCall(`/team-settings/${teamId}/transfer-ownership`, {
            method: 'POST',
            body: JSON.stringify({ new_owner_id: userId })
        });
        
        if (response.ok) {
            showToast('Ownership transferred successfully', 'success');
            await initializeTeamSettings();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to transfer ownership', 'error');
        }
    } catch (error) {
        console.error('Error transferring ownership:', error);
        showToast('Failed to transfer ownership', 'error');
    }
}

async function removeMember(userId) {
    if (!confirm('Are you sure you want to remove this member?')) return;
    
    try {
        const teamId = currentUser.current_team_id;
        const response = await apiCall(`/team-settings/${teamId}/members/${userId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Member removed successfully', 'success');
            // Reload team settings
            await initializeTeamSettings();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to remove member', 'error');
        }
    } catch (error) {
        console.error('Error removing member:', error);
        showToast('Failed to remove member', 'error');
    }
}

async function resendInvitation(invitationId) {
    try {
        const teamId = currentUser.current_team_id;
        const response = await apiCall(`/team-settings/${teamId}/invitations/${invitationId}/resend`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Invitation resent successfully', 'success');
            await initializeTeamSettings();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to resend invitation', 'error');
        }
    } catch (error) {
        console.error('Error resending invitation:', error);
        showToast('Failed to resend invitation', 'error');
    }
}

async function cancelInvitation(invitationId) {
    if (!confirm('Are you sure you want to cancel this invitation?')) return;
    
    try {
        const teamId = currentUser.current_team_id;
        const response = await apiCall(`/team-settings/${teamId}/invitations/${invitationId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Invitation cancelled successfully', 'success');
            await initializeTeamSettings();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to cancel invitation', 'error');
        }
    } catch (error) {
        console.error('Error cancelling invitation:', error);
        showToast('Failed to cancel invitation', 'error');
    }
}

async function loadTeamInstagramStatus(teamId) {
    try {
        const response = await apiCall(`/team-settings/${teamId}/instagram`);
        if (response.ok) {
            const data = await response.json();
            const statusEl = document.getElementById('teamInstagramStatus');
            const formEl = document.getElementById('teamInstagramForm');
            
            if (data.instagram_connected) {
                statusEl.innerHTML = `
                    <div class="info-box">
                        <p>✓ Connected to <strong>@${data.instagram_username}</strong></p>
                        <p style="font-size: 0.9em; color: #666; margin-top: 8px;">
                            Token expires: ${new Date(data.token_expires_at).toLocaleDateString()}
                        </p>
                        <button class="btn btn-sm btn-danger" onclick="disconnectTeamInstagram(${teamId})" style="margin-top: 10px;">
                            Disconnect Instagram
                        </button>
                    </div>
                `;
                if (formEl) formEl.style.display = 'none';
            } else {
                statusEl.innerHTML = `<p style="color: #666;">Not connected yet. Add your Instagram credentials below.</p>`;
                if (formEl) formEl.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error loading Instagram status:', error);
    }
}

async function connectTeamInstagram(teamId) {
    const token = document.getElementById('teamInstagramToken')?.value;
    const accountId = document.getElementById('teamInstagramAccountId')?.value;
    
    if (!token) {
        showToast('Please enter an access token', 'error');
        return;
    }
    
    try {
        const response = await apiCall(`/team-settings/${teamId}/instagram/connect`, {
            method: 'POST',
            body: JSON.stringify({
                access_token: token,
                instagram_account_id: accountId || undefined
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast(`Instagram connected: @${data.instagram_username}`, 'success');
            document.getElementById('teamInstagramToken').value = '';
            document.getElementById('teamInstagramAccountId').value = '';
            await loadTeamInstagramStatus(teamId);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to connect Instagram', 'error');
        }
    } catch (error) {
        console.error('Error connecting Instagram:', error);
        showToast('Failed to connect Instagram', 'error');
    }
}

async function disconnectTeamInstagram(teamId) {
    if (!confirm('Are you sure you want to disconnect this Instagram account?')) return;
    
    try {
        const response = await apiCall(`/team-settings/${teamId}/instagram/disconnect`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Instagram disconnected successfully', 'success');
            await loadTeamInstagramStatus(teamId);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to disconnect Instagram', 'error');
        }
    } catch (error) {
        console.error('Error disconnecting Instagram:', error);
        showToast('Failed to disconnect Instagram', 'error');
    }
}

async function saveTeamInfo(teamId, originalTeamData) {
    const name = document.getElementById('teamNameInput')?.value.trim();
    const description = document.getElementById('teamDescriptionInput')?.value.trim();
    
    if (!name) {
        showToast('Team name cannot be empty', 'error');
        return;
    }
    
    try {
        const response = await apiCall(`/teams/teams/${teamId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, description })
        });
        
        if (response.ok) {
            showToast('Team information updated successfully', 'success');
            // Update display
            document.getElementById('teamName').textContent = name;
            document.getElementById('teamDescription').textContent = description || 'No description';
            // Hide edit form, show display
            document.getElementById('teamInfoDisplay').style.display = 'block';
            document.getElementById('teamInfoEdit').style.display = 'none';
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to update team information', 'error');
        }
    } catch (error) {
        console.error('Error saving team info:', error);
        showToast('Failed to update team information', 'error');
    }
}

async function inviteTeamMember(teamId) {
    // Prevent duplicate requests
    if (window._invitingInProgress) {
        console.log('Invite already in progress');
        return;
    }
    
    const email = document.getElementById('inviteMemberEmail')?.value;
    
    console.log('Invite button clicked, email:', email, 'teamId:', teamId);
    
    if (!email) {
        showToast('Please enter an email address', 'error');
        return;
    }
    
    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('Please enter a valid email address', 'error');
        return;
    }
    
    window._invitingInProgress = true;
    const inviteBtn = document.getElementById('inviteMemberBtn');
    if (inviteBtn) inviteBtn.disabled = true;
    
    try {
        const response = await apiCall(`/team-settings/${teamId}/invite`, {
            method: 'POST',
            body: JSON.stringify({ email })
        });
        
        console.log('Invite response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            showToast(`Invitation sent to ${email}`, 'success');
            document.getElementById('inviteMemberEmail').value = '';
            // Reload invitations only, not the entire team settings
            const headers = {'Authorization': `Bearer ${localStorage.getItem('access_token')}`};
            const invResponse = await fetch(`/api/team-settings/${teamId}/invitations`, { headers });
            if (invResponse.ok) {
                const invData = await invResponse.json();
                renderPendingInvitations(invData.invitations);
            }
        } else {
            const data = await response.json();
            console.log('Invite error:', data);
            showToast(data.error || 'Failed to send invitation', 'error');
        }
    } catch (error) {
        console.error('Error inviting team member:', error);
        showToast('Failed to send invitation', 'error');
    } finally {
        window._invitingInProgress = false;
        if (inviteBtn) inviteBtn.disabled = false;
    }
}

async function initializeAdminSettings() {
    try {
        if (!currentUser?.is_super_admin) {
            console.log('User is not a super admin');
            return;
        }
        
        console.log('Loading admin settings');
        
        // Load users
        const usersResponse = await apiCall('/admin-settings/users');
        if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            renderAdminUsers(usersData.users);
            
            // Setup refresh button
            const usersRefreshBtn = document.getElementById('usersRefresh');
            if (usersRefreshBtn) {
                usersRefreshBtn.addEventListener('click', () => loadAdminUsers());
            }
            
            // Setup search
            const usersSearchInput = document.getElementById('usersSearch');
            if (usersSearchInput) {
                usersSearchInput.addEventListener('input', (e) => {
                    const filtered = usersData.users.filter(u => 
                        u.name.toLowerCase().includes(e.target.value.toLowerCase()) ||
                        u.email.toLowerCase().includes(e.target.value.toLowerCase())
                    );
                    renderAdminUsers(filtered);
                });
            }
        }
        
        // Load teams
        const teamsResponse = await apiCall('/admin-settings/teams');
        if (teamsResponse.ok) {
            const teamsData = await teamsResponse.json();
            renderAdminTeams(teamsData.teams);
            
            // Setup refresh button
            const teamsRefreshBtn = document.getElementById('teamsRefresh');
            if (teamsRefreshBtn) {
                teamsRefreshBtn.addEventListener('click', () => loadAdminTeams());
            }
            
            // Setup search
            const teamsSearchInput = document.getElementById('teamsSearch');
            if (teamsSearchInput) {
                teamsSearchInput.addEventListener('input', (e) => {
                    const filtered = teamsData.teams.filter(t => 
                        t.name.toLowerCase().includes(e.target.value.toLowerCase())
                    );
                    renderAdminTeams(filtered);
                });
            }
        }
        
        // Load domain settings
        const domainResponse = await apiCall('/admin-settings/domain');
        if (domainResponse.ok) {
            const domainData = await domainResponse.json();
            const domainInput = document.getElementById('appDomainInput');
            if (domainInput) domainInput.value = domainData.domain || '';
        }
        
        // Setup domain save button
        const saveDomainBtn = document.getElementById('saveDomainBtn');
        if (saveDomainBtn) {
            saveDomainBtn.addEventListener('click', saveAppDomain);
        }
        
        // Load email settings
        loadEmailSettings();
        
        // Setup email buttons
        const saveEmailBtn = document.getElementById('saveEmailSettingsBtn');
        if (saveEmailBtn) {
            saveEmailBtn.addEventListener('click', saveEmailSettings);
        }
        
        const testEmailBtn = document.getElementById('testEmailBtn');
        if (testEmailBtn) {
            testEmailBtn.addEventListener('click', sendTestEmail);
        }
        
        // Setup create team button
        const createTeamBtn = document.getElementById('createTeamBtn');
        if (createTeamBtn) {
            createTeamBtn.addEventListener('click', showCreateTeamModal);
        }
        
    } catch (error) {
        console.error('Error in initializeAdminSettings:', error);
    }
}

async function loadAdminUsers() {
    try {
        const response = await apiCall('/admin-settings/users');
        const data = await response.json();
        if (response.ok) {
            renderAdminUsers(data.users);
        }
    } catch (error) {
        console.error('Error loading admin users:', error);
    }
}

async function loadAdminTeams() {
    try {
        const response = await apiCall('/admin-settings/teams');
        const data = await response.json();
        if (response.ok) {
            renderAdminTeams(data.teams);
        }
    } catch (error) {
        console.error('Error loading admin teams:', error);
    }
}

function renderAdminUsers(users) {
    const container = document.getElementById('adminUsersContainer');
    if (!container) return;
    
    if (!users || users.length === 0) {
        container.innerHTML = '<div class="empty-state">No users found</div>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Admin</th>
                <th>Active</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            ${users.map(user => `
                <tr>
                    <td>${user.name}</td>
                    <td>${user.email}</td>
                    <td>${user.is_super_admin ? '✓' : '✗'}</td>
                    <td>${user.is_active ? '✓' : '✗'}</td>
                    <td>
                        ${user.id !== currentUser.id ? `
                            ${!user.is_super_admin ? `
                                <button class="btn btn-sm btn-success" onclick="promoteToAdmin(${user.id})">Promote</button>
                            ` : `
                                <button class="btn btn-sm btn-warning" onclick="demoteFromAdmin(${user.id})">Demote</button>
                            `}
                            ${user.is_active ? `
                                <button class="btn btn-sm btn-danger" onclick="deactivateUser(${user.id})">Deactivate</button>
                            ` : ''}
                            <button class="btn btn-sm btn-dark" onclick="deleteUser(${user.id})">Delete</button>
                        ` : '<span class="text-muted">Self</span>'}
                    </td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
}

function renderAdminTeams(teams) {
    const container = document.getElementById('adminTeamsContainer');
    if (!container) return;
    
    if (!teams || teams.length === 0) {
        container.innerHTML = '<div class="empty-state">No teams found</div>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Created By</th>
                <th>Created Date</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            ${teams.map(team => `
                <tr>
                    <td>${team.name}</td>
                    <td>${team.description || '-'}</td>
                    <td>${team.created_by_name || 'Unknown'}</td>
                    <td>${new Date(team.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="editTeam(${team.id})">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteTeam(${team.id})">Delete</button>
                    </td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
}

async function saveAppDomain() {
    const domain = document.getElementById('appDomainInput')?.value;
    if (!domain) {
        showToast('Please enter a domain', 'error');
        return;
    }
    
    try {
        const response = await apiCall('/admin-settings/domain', {
            method: 'POST',
            body: JSON.stringify({ domain })
        });
        
        if (response.ok) {
            showToast('Domain saved successfully', 'success');
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to save domain', 'error');
        }
    } catch (error) {
        console.error('Error saving domain:', error);
        showToast('Failed to save domain', 'error');
    }
}

async function loadEmailSettings() {
    try {
        const response = await apiCall('/admin-settings/email');
        if (response.ok) {
            const data = await response.json();
            
            // Populate form fields
            const mailServer = document.getElementById('mailServer');
            const mailPort = document.getElementById('mailPort');
            const mailUseTLS = document.getElementById('mailUseTLS');
            const mailUsername = document.getElementById('mailUsername');
            const mailPassword = document.getElementById('mailPassword');
            const mailFromEmail = document.getElementById('mailFromEmail');
            const mailFromName = document.getElementById('mailFromName');
            
            if (mailServer) mailServer.value = data.mail_server || '';
            if (mailPort) mailPort.value = data.mail_port || 587;
            if (mailUseTLS) mailUseTLS.checked = data.mail_use_tls === true || data.mail_use_tls === 'true';
            if (mailUsername) mailUsername.value = data.mail_username || '';
            if (mailPassword) mailPassword.value = data.mail_password || '';
            if (mailFromEmail) mailFromEmail.value = data.mail_from_email || 'noreply@postwave.com';
            if (mailFromName) mailFromName.value = data.mail_from_name || 'PostWave';
        }
    } catch (error) {
        console.error('Error loading email settings:', error);
    }
}

async function saveEmailSettings() {
    try {
        const settings = {
            mail_server: document.getElementById('mailServer')?.value || '',
            mail_port: parseInt(document.getElementById('mailPort')?.value || '587'),
            mail_use_tls: document.getElementById('mailUseTLS')?.checked || false,
            mail_username: document.getElementById('mailUsername')?.value || '',
            mail_password: document.getElementById('mailPassword')?.value || '',
            mail_from_email: document.getElementById('mailFromEmail')?.value || 'noreply@postwave.com',
            mail_from_name: document.getElementById('mailFromName')?.value || 'PostWave'
        };
        
        // Validate required fields
        if (!settings.mail_server) {
            showToast('Mail server is required', 'error');
            return;
        }
        if (!settings.mail_username) {
            showToast('Mail username is required', 'error');
            return;
        }
        if (!settings.mail_password) {
            showToast('Mail password is required', 'error');
            return;
        }
        
        const response = await apiCall('/admin-settings/email', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        
        if (response.ok) {
            showToast('Email settings saved successfully', 'success');
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to save email settings', 'error');
        }
    } catch (error) {
        console.error('Error saving email settings:', error);
        showToast('Failed to save email settings', 'error');
    }
}

async function sendTestEmail() {
    try {
        const testEmail = document.getElementById('mailFromEmail')?.value || currentUser?.email;
        
        if (!testEmail) {
            showToast('Please configure a from email first', 'error');
            return;
        }
        
        showToast('Sending test email...', 'info');
        
        const response = await apiCall('/admin-settings/email/test', {
            method: 'POST',
            body: JSON.stringify({ email: testEmail })
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast(`✓ Test email sent to ${data.recipient}`, 'success');
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to send test email', 'error');
        }
    } catch (error) {
        console.error('Error sending test email:', error);
        showToast('Failed to send test email', 'error');
    }
}

async function promoteToAdmin(userId) {
    if (!confirm('Promote this user to admin?')) return;
    
    try {
        const response = await apiCall(`/admin-settings/users/${userId}/promote`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('User promoted to admin', 'success');
            await loadAdminUsers();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to promote user', 'error');
        }
    } catch (error) {
        console.error('Error promoting user:', error);
        showToast('Failed to promote user', 'error');
    }
}

async function demoteFromAdmin(userId) {
    if (!confirm('Demote this user from admin?')) return;
    
    try {
        const response = await apiCall(`/admin-settings/users/${userId}/demote`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('User demoted from admin', 'success');
            await loadAdminUsers();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to demote user', 'error');
        }
    } catch (error) {
        console.error('Error demoting user:', error);
        showToast('Failed to demote user', 'error');
    }
}

async function deactivateUser(userId) {
    if (!confirm('Deactivate this user?')) return;
    
    try {
        const response = await apiCall(`/admin-settings/users/${userId}/deactivate`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('User deactivated', 'success');
            await loadAdminUsers();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to deactivate user', 'error');
        }
    } catch (error) {
        console.error('Error deactivating user:', error);
        showToast('Failed to deactivate user', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Permanently delete this user? This cannot be undone!')) return;
    
    try {
        const response = await apiCall(`/admin-settings/users/${userId}/delete`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('User deleted', 'success');
            await loadAdminUsers();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to delete user', 'error');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast('Failed to delete user', 'error');
    }
}

function showCreateTeamModal() {
    // TODO: Implement create team modal
    showToast('Create team modal not yet implemented', 'info');
}

async function editTeam(teamId) {
    // TODO: Implement edit team modal
    showToast('Edit team modal not yet implemented', 'info');
}

async function deleteTeam(teamId) {
    if (!confirm('Delete this team? This cannot be undone!')) return;
    
    try {
        const response = await apiCall(`/admin-settings/teams/${teamId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Team deleted', 'success');
            await loadAdminTeams();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to delete team', 'error');
        }
    } catch (error) {
        console.error('Error deleting team:', error);
        showToast('Failed to delete team', 'error');
    }
}

function renderLogs(logs, containerId) {
    const container = document.getElementById(containerId);
    
    if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="empty-state">No activity logs found</div>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date & Time</th>
                <th>Action</th>
                <th>Description</th>
            </tr>
        </thead>
        <tbody>
            ${logs.map(log => `
                <tr>
                    <td>${new Date(log.created_at).toLocaleString()}</td>
                    <td><span class="status-badge" style="background: rgba(0,123,255,0.1); color: var(--primary-color);">${log.action_type}</span></td>
                    <td>${log.description}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
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
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await apiCall('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
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


// New invitation flow - Step 1: Accept Invitation
async function handleAcceptInvitation() {
    const token = new URLSearchParams(window.location.search).get('token');
    
    if (!token) {
        showToast('Invalid invitation link', 'error');
        navigateTo('/login');
        return;
    }
    
    // Load invitation details and check if user exists
    try {
        const response = await fetch(`/api/teams/accept-invite/${token}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        console.log('handleAcceptInvitation - API response:', {
            ok: response.ok,
            currentUser: !!currentUser,
            user_exists: data.user_exists,
            email: data.email
        });
        
        if (response.ok) {
            // Check if user is already logged in
            if (currentUser) {
                console.log('User already logged in, redirecting to dashboard');
                showToast('You are already logged in. Joining team...', 'info');
                // Accept the invitation for already logged in user
                try {
                    const acceptResponse = await apiCall(`/teams/accept-invite/${token}`, {
                        method: 'POST',
                        body: JSON.stringify({ name: currentUser.name }),
                        skipAuth: false,
                    });
                    if (acceptResponse.ok) {
                        showToast('Successfully joined team!', 'success');
                        setTimeout(() => navigateTo('/dashboard'), 500);
                    }
                } catch (err) {
                    console.error('Error accepting invitation:', err);
                }
            } else if (data.user_exists) {
                console.log('Showing login form - User exists, need login');
                showStep2b(data);
            } else {
                console.log('Showing registration form - New user');
                showStep2a(data);
            }
        } else {
            showToast(data.error || 'Invalid invitation', 'error');
        }
    } catch (error) {
        console.error('Error accepting invitation:', error);
        showToast('An error occurred', 'error');
    }
}

// Step 2a: Create new account
function showStep2a(invitationData) {
    // Check if elements exist
    const step1Buttons = document.getElementById('step1Buttons');
    const createAccountForm = document.getElementById('createAccountForm');
    const createEmail = document.getElementById('createEmail');
    
    if (!step1Buttons || !createAccountForm || !createEmail) {
        console.error('Required elements not found for showStep2a');
        showToast('Error loading invitation page', 'error');
        return;
    }
    
    // Hide step 1 buttons and show step 2a form
    step1Buttons.style.display = 'none';
    createAccountForm.style.display = 'block';
    
    // Pre-fill email
    createEmail.value = invitationData.email;
    
    console.log('showStep2a - Registration form displayed for:', invitationData.email);
}

// Step 2a: Handle create account form submission
async function handleCreateAccountStep2a(e) {
    e.preventDefault();
    
    const password = document.getElementById('createPassword').value;
    const passwordConfirm = document.getElementById('createPasswordConfirm').value;
    const name = document.getElementById('createName').value;
    
    if (password !== passwordConfirm) {
        showToast('Passwords do not match', 'error');
        return;
    }
    
    if (password.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }
    
    const token = new URLSearchParams(window.location.search).get('token');
    
    if (!token) {
        showToast('Invalid invitation link', 'error');
        navigateTo('/login');
        return;
    }
    
    try {
        const response = await apiCall(`/teams/accept-invite/${token}`, {
            method: 'POST',
            body: JSON.stringify({ password, name }),
            skipAuth: true,
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Account created successfully! Please log in with your credentials.', 'success');
            
            // Store the invitation data for later
            window.currentInvitationData = data;
            
            // Show the login form instead of trying to go to dashboard
            // User needs to login to properly authenticate
            const createAccountForm = document.getElementById('createAccountForm');
            const invitationLoginForm = document.getElementById('invitationLoginForm');
            const invitationLoginEmail = document.getElementById('invitationLoginEmail');
            const loginTeamName = document.getElementById('loginTeamName');
            
            if (createAccountForm) createAccountForm.style.display = 'none';
            if (invitationLoginForm) {
                invitationLoginForm.style.display = 'block';
                if (invitationLoginEmail) invitationLoginEmail.value = data.email;
                if (loginTeamName) loginTeamName.textContent = data.team?.name || 'the team';
            }
            
            console.log('Account created, showing login form for:', data.email);
        } else {
            showToast(data.error || 'Failed to create account', 'error');
        }
    } catch (error) {
        console.error('Error creating account:', error);
        showToast('An error occurred', 'error');
    }
}

// Step 2b: Existing user needs to login
function showStep2b(invitationData) {
    // Check if elements exist
    const step1Buttons = document.getElementById('step1Buttons');
    const invitationLoginForm = document.getElementById('invitationLoginForm');
    const invitationLoginEmail = document.getElementById('invitationLoginEmail');
    const loginTeamName = document.getElementById('loginTeamName');
    
    if (!step1Buttons || !invitationLoginForm || !invitationLoginEmail || !loginTeamName) {
        console.error('Required elements not found for showStep2b');
        showToast('Error loading invitation page', 'error');
        return;
    }
    
    // Hide step 1 buttons and show step 2b form
    step1Buttons.style.display = 'none';
    invitationLoginForm.style.display = 'block';
    
    // Pre-fill email
    invitationLoginEmail.value = invitationData.email;
    loginTeamName.textContent = invitationData.team?.name || 'the team';
    
    console.log('showStep2b - Login form displayed for existing user:', invitationData.email);
}

// Step 2b: Handle login form submission
async function handleLoginStep2b(e) {
    e.preventDefault();
    
    const password = document.getElementById('invitationLoginPassword').value;
    const token = new URLSearchParams(window.location.search).get('token');
    
    if (!token) {
        showToast('Invalid invitation link', 'error');
        navigateTo('/login');
        return;
    }
    
    const email = document.getElementById('invitationLoginEmail').value;
    
    try {
        // First login the user
        const loginResponse = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const loginData = await loginResponse.json();
        
        if (loginResponse.ok) {
            // Set tokens so apiCall will work properly
            localStorage.setItem('access_token', loginData.access_token);
            localStorage.setItem('refresh_token', loginData.refresh_token);
            currentUser = loginData.user;
            
            // Now accept the invitation with the token
            const response = await apiCall(`/teams/accept-invite/${token}`, {
                method: 'POST',
                body: JSON.stringify({ password, name: loginData.user.name }),
                skipAuth: false,
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showToast('Logged in and joined team successfully!', 'success');
                invitationToken = null;
                invitationDetailsLoaded = false;
                
                // Redirect to dashboard
                setTimeout(() => navigateTo('/dashboard'), 500);
            } else {
                showToast(data.error || 'Failed to join team', 'error');
            }
        } else {
            showToast(loginData.error || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Error logging in:', error);
        showToast('An error occurred', 'error');
    }
}

// Step 2c: Proceed to team dashboard
async function handleProceedToTeamDashboard() {
    navigateTo('/dashboard');
}

// Decline invitation
async function handleDeclineInvitation() {
    showToast('Invitation declined', 'info');
    navigateTo('/login');
}

async function loadInvitationDetails(token) {
    try {
        const response = await fetch(`/api/teams/accept-invite/${token}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Store invitation data for later use
            window.currentInvitationData = data;
            
            const invitationTeamNameEl = document.getElementById('invitationTeamName');
            if (invitationTeamNameEl && data.team) {
                invitationTeamNameEl.textContent = `Join ${data.team.name}`;
            }
            
            const invitationExpiryEl = document.getElementById('invitationExpiry');
            if (invitationExpiryEl && data.expires_at) {
                const expiryDate = new Date(data.expires_at);
                const now = new Date();
                const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                invitationExpiryEl.textContent = `Invitation expires in ${daysLeft} days`;
            }
            
            // Show step 1 buttons
            const step1ButtonsEl = document.getElementById('step1Buttons');
            if (step1ButtonsEl) {
                step1ButtonsEl.style.display = 'flex';
            }
        } else {
            // Show error page instead of redirecting
            const loginPage = document.getElementById('loginPage');
            const invitationPage = document.getElementById('invitationPage');
            
            if (invitationPage) {
                invitationPage.innerHTML = `
                    <div class="auth-container">
                        <div class="auth-header">
                            <h1>PostWave</h1>
                        </div>
                        <div style="text-align: center; padding: 2rem 0;">
                            <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
                            <h2 style="margin-bottom: 1rem; font-size: 1.5rem;">${data.error || 'Invalid Invitation'}</h2>
                            <p style="color: var(--text-secondary); margin-bottom: 2rem;">
                                ${data.error === 'Invitation already accepted or declined' ? 'This invitation has already been used.' : 
                                  data.error === 'Invitation has expired' ? 'This invitation link has expired.' : 
                                  'This invitation is no longer valid.'}
                            </p>
                            <a href="/login" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Back to Login</a>
                        </div>
                    </div>
                `;
            }
            if (loginPage) loginPage.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading invitation:', error);
        const invitationPage = document.getElementById('invitationPage');
        const loginPage = document.getElementById('loginPage');
        
        if (invitationPage) {
            invitationPage.innerHTML = `
                <div class="auth-container">
                    <div class="auth-header">
                        <h1>PostWave</h1>
                    </div>
                    <div style="text-align: center; padding: 2rem 0;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
                        <h2 style="margin-bottom: 1rem; font-size: 1.5rem;">Invalid Invitation</h2>
                        <p style="color: var(--text-secondary); margin-bottom: 2rem;">
                            The invitation link is invalid or has expired.
                        </p>
                        <a href="/login" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Back to Login</a>
                    </div>
                </div>
            `;
        }
        if (loginPage) loginPage.style.display = 'none';
    }
}

function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    currentUser = null;
    navbarListenersSetup = false; // Reset the flag so listeners can be set up again on next login
    invitationDetailsLoaded = false; // Reset invitation flag
    invitationToken = null; // Clear invitation token
    navigateTo('/login');
    showToast('Logged out successfully', 'info');
}

async function fetchCurrentUser() {
    try {
        const response = await apiCall('/auth/me');
        const data = await response.json();
        
        if (response.ok) {
            currentUser = data;
            
            // Cache profile data for preview
            userProfileData = {
                username: data.instagram_username || data.name,
                profilePicture: data.profile_picture || null
            };
            
            const navUsername = document.getElementById('navUsername');
            const previewUsername = document.getElementById('previewUsername');
            if (navUsername) navUsername.textContent = data.name;
            if (previewUsername) previewUsername.textContent = userProfileData.username;
            
            // Fetch and display current team
            try {
                const teamsResponse = await apiCall('/teams/teams');
                const teamsData = await teamsResponse.json();
                if (teamsResponse.ok && teamsData.teams && teamsData.teams.length > 0) {
                    // Use first team as current team (can be improved with user's preferred team)
                    const currentTeam = teamsData.teams[0];
                    currentUser.current_team_id = currentTeam.id;
                    
                    const navTeamName = document.getElementById('navTeamName');
                    if (navTeamName) {
                        navTeamName.textContent = currentTeam.name;
                    }
                }
            } catch (error) {
                console.warn('Failed to fetch teams:', error);
                // Continue anyway - teams are optional
            }
            
            // Fetch profile picture if user has Instagram connected and no picture cached yet
            if (data.instagram_connected && !data.profile_picture) {
                try {
                    await fetchProfilePicture();
                } catch (error) {
                    console.warn('Failed to fetch profile picture:', error);
                    // Continue anyway - the preview can work without profile picture
                }
            }
            
            // Update profile picture in preview
            updateProfilePicturePreview();
            
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

function updateProfilePicturePreview() {
    if (!userProfileData) return;
    
    // Update username in preview
    const previewUsername = document.getElementById('previewUsername');
    if (previewUsername && userProfileData.username) {
        previewUsername.textContent = userProfileData.username;
    }
    
    const avatarEl = document.querySelector('.ig-avatar');
    if (!avatarEl) return;
    
    if (userProfileData.profilePicture) {
        avatarEl.style.backgroundImage = `url('${userProfileData.profilePicture}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
    } else {
        // Fallback to initial-based avatar
        avatarEl.style.backgroundImage = 'none';
        if (userProfileData.username) {
            avatarEl.textContent = userProfileData.username.charAt(0).toUpperCase();
        }
    }
}

async function fetchProfilePicture() {
    try {
        const response = await apiCall('/instagram/fetch-profile-picture', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.profile_picture_url) {
            // Update profile data cache
            if (userProfileData) {
                userProfileData.profilePicture = data.profile_picture_url;
            }
            
            // Update preview immediately
            updateProfilePicturePreview();
            
            console.log('Profile picture fetched and cached successfully');
        }
    } catch (error) {
        console.warn('Failed to fetch profile picture:', error);
        // Don't throw - this is non-blocking
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
        const response = await apiCall('/instagram/refresh-cache', { method: 'POST' });
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

// Convert aspect ratio format from "1:1" to "1/1" or decimal
function normalizeAspectRatio(ratio) {
    if (ratio === 'original' || ratio === 'auto') {
        return 'auto';
    }
    
    // If it contains ":", convert to "/"
    if (ratio.includes(':')) {
        const parts = ratio.split(':');
        if (parts.length === 2) {
            const width = parseFloat(parts[0]);
            const height = parseFloat(parts[1]);
            if (!isNaN(width) && !isNaN(height)) {
                return width / height;
            }
        }
    }
    
    // If it's already a decimal or ratio with "/", use as-is
    return ratio;
}

function displayMediaPreview() {
    const container = document.getElementById('mediaPreview');
    container.innerHTML = '';
    
    // Get current aspect ratio
    let aspectRatio = document.getElementById('aspectRatio').value;
    if (aspectRatio === 'custom') {
        const customRatio = document.getElementById('customAspectRatio').value;
        aspectRatio = customRatio || 'original';
    }
    
    // Normalize aspect ratio for CSS
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    
    // Create placeholder divs in correct order first
    const divs = [];
    selectedFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'media-preview-item';
        div.setAttribute('data-index', index);
        div.style.aspectRatio = normalizedRatio;
        
        container.appendChild(div);
        divs[index] = div;
    });
    
    // Now load images and populate in correct order
    selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = divs[index];
            if (div) {
                const img = new Image();
                img.onload = () => {
                    // Create canvas for cropped preview if crop data exists
                    if (cropData[index] && cropData[index].cropped) {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        // Get current aspect ratio from dropdown
                        let aspectRatio = document.getElementById('aspectRatio').value;
                        if (aspectRatio === 'custom') {
                            const customRatio = document.getElementById('customAspectRatio').value;
                            aspectRatio = customRatio || '1:1';
                        }
                        
                        // Parse target aspect ratio
                        let targetRatio;
                        if (aspectRatio === 'original') {
                            targetRatio = img.width / img.height;
                        } else if (aspectRatio.includes(':')) {
                            const [w, h] = aspectRatio.split(':').map(parseFloat);
                            targetRatio = w / h;
                        } else {
                            targetRatio = parseFloat(aspectRatio);
                        }
                        
                        // Get stored center point
                        const centerX = cropData[index].centerX;
                        const centerY = cropData[index].centerY;
                        
                        // Calculate box dimensions based on current aspect ratio
                        // Try to keep the stored size, but adjust to match current aspect ratio
                        let boxWidth, boxHeight;
                        const storedBoxWidth = cropData[index].boxWidth;
                        const storedBoxHeight = cropData[index].boxHeight;
                        
                        // Try to maximize crop area while maintaining aspect ratio
                        const possibleWidthFromHeight = storedBoxHeight * targetRatio;
                        const possibleHeightFromWidth = storedBoxWidth / targetRatio;
                        
                        if (possibleWidthFromHeight <= img.width) {
                            boxWidth = possibleWidthFromHeight;
                            boxHeight = storedBoxHeight;
                        } else if (possibleHeightFromWidth <= img.height) {
                            boxWidth = storedBoxWidth;
                            boxHeight = possibleHeightFromWidth;
                        } else {
                            // Scale down
                            if (storedBoxWidth / img.width > storedBoxHeight / img.height) {
                                boxWidth = storedBoxWidth;
                                boxHeight = boxWidth / targetRatio;
                            } else {
                                boxHeight = storedBoxHeight;
                                boxWidth = boxHeight * targetRatio;
                            }
                        }
                        
                        // Calculate crop position from center
                        const cropX = centerX - boxWidth / 2;
                        const cropY = centerY - boxHeight / 2;
                        
                        // Clamp to image bounds
                        const clampedX = Math.max(0, Math.min(cropX, img.width - boxWidth));
                        const clampedY = Math.max(0, Math.min(cropY, img.height - boxHeight));
                        const clampedW = Math.min(boxWidth, img.width - clampedX);
                        const clampedH = Math.min(boxHeight, img.height - clampedY);
                        
                        canvas.width = clampedW;
                        canvas.height = clampedH;
                        ctx.drawImage(img, clampedX, clampedY, clampedW, clampedH, 0, 0, clampedW, clampedH);
                        
                        div.innerHTML = `
                            <img src="${canvas.toDataURL('image/jpeg')}" alt="Preview ${index + 1}" onclick="openCropModal(${index})">
                            <button type="button" class="media-preview-remove" onclick="removeMedia(${index})">&times;</button>
                            <div class="crop-badge" title="Cropped - click image to re-crop">✓</div>
                            <div class="media-reorder-controls">
                                <button type="button" class="media-move-btn ${index === 0 ? 'disabled' : ''}" onclick="moveMediaToFirst(${index})" ${index === 0 ? 'disabled' : ''} title="Move to first">⏮</button>
                                <button type="button" class="media-move-btn ${index === 0 ? 'disabled' : ''}" onclick="moveMediaUp(${index})" ${index === 0 ? 'disabled' : ''} title="Move left">←</button>
                                <button type="button" class="media-move-btn ${index === selectedFiles.length - 1 ? 'disabled' : ''}" onclick="moveMediaDown(${index})" ${index === selectedFiles.length - 1 ? 'disabled' : ''} title="Move right">→</button>
                                <button type="button" class="media-move-btn ${index === selectedFiles.length - 1 ? 'disabled' : ''}" onclick="moveMediaToLast(${index})" ${index === selectedFiles.length - 1 ? 'disabled' : ''} title="Move to last">⏭</button>
                            </div>
                        `;
                    } else {
                        div.innerHTML = `
                            <img src="${e.target.result}" alt="Preview ${index + 1}" onclick="openCropModal(${index})">
                            <button type="button" class="media-preview-remove" onclick="removeMedia(${index})">&times;</button>
                            <div class="media-reorder-controls">
                                <button type="button" class="media-move-btn ${index === 0 ? 'disabled' : ''}" onclick="moveMediaToFirst(${index})" ${index === 0 ? 'disabled' : ''} title="Move to first">⏮</button>
                                <button type="button" class="media-move-btn ${index === 0 ? 'disabled' : ''}" onclick="moveMediaUp(${index})" ${index === 0 ? 'disabled' : ''} title="Move left">←</button>
                                <button type="button" class="media-move-btn ${index === selectedFiles.length - 1 ? 'disabled' : ''}" onclick="moveMediaDown(${index})" ${index === selectedFiles.length - 1 ? 'disabled' : ''} title="Move right">→</button>
                                <button type="button" class="media-move-btn ${index === selectedFiles.length - 1 ? 'disabled' : ''}" onclick="moveMediaToLast(${index})" ${index === selectedFiles.length - 1 ? 'disabled' : ''} title="Move to last">⏭</button>
                            </div>
                        `;
                    }
                };
                img.src = e.target.result;
            }
        };
        reader.readAsDataURL(file);
    });
}

function moveMediaUp(index) {
    if (index > 0) {
        // Add animation to container
        const container = document.getElementById('mediaPreview');
        container.classList.add('reordering');
        
        // Swap with previous item
        const temp = selectedFiles[index];
        selectedFiles[index] = selectedFiles[index - 1];
        selectedFiles[index - 1] = temp;
        
        // Swap crop data too
        const tempCrop = cropData[index];
        cropData[index] = cropData[index - 1];
        cropData[index - 1] = tempCrop;
        
        // Update carousel index if needed
        if (currentCarouselIndex === index) {
            currentCarouselIndex = index - 1;
        } else if (currentCarouselIndex === index - 1) {
            currentCarouselIndex = index;
        }
        
        setTimeout(() => {
            displayMediaPreview();
            updatePreview();
            container.classList.remove('reordering');
        }, 150);
    }
}

function moveMediaDown(index) {
    if (index < selectedFiles.length - 1) {
        // Add animation to container
        const container = document.getElementById('mediaPreview');
        container.classList.add('reordering');
        
        // Swap with next item
        const temp = selectedFiles[index];
        selectedFiles[index] = selectedFiles[index + 1];
        selectedFiles[index + 1] = temp;
        
        // Swap crop data too
        const tempCrop = cropData[index];
        cropData[index] = cropData[index + 1];
        cropData[index + 1] = tempCrop;
        
        // Update carousel index if needed
        if (currentCarouselIndex === index) {
            currentCarouselIndex = index + 1;
        } else if (currentCarouselIndex === index + 1) {
            currentCarouselIndex = index;
        }
        
        setTimeout(() => {
            displayMediaPreview();
            updatePreview();
            container.classList.remove('reordering');
        }, 150);
    }
}

function moveMediaToFirst(index) {
    if (index > 0) {
        const container = document.getElementById('mediaPreview');
        container.classList.add('reordering');
        
        // Move to first
        const item = selectedFiles.splice(index, 1)[0];
        selectedFiles.unshift(item);
        
        const itemCrop = cropData[index];
        delete cropData[index];
        
        // Rebuild crop indices
        const newCropData = {};
        Object.keys(cropData).forEach(key => {
            const idx = parseInt(key);
            if (idx < index) {
                newCropData[idx + 1] = cropData[idx];
            } else {
                newCropData[idx] = cropData[idx];
            }
        });
        if (itemCrop) {
            newCropData[0] = itemCrop;
        }
        cropData = newCropData;
        
        // Update carousel index
        if (currentCarouselIndex === index) {
            currentCarouselIndex = 0;
        } else if (currentCarouselIndex < index) {
            currentCarouselIndex++;
        }
        
        setTimeout(() => {
            displayMediaPreview();
            updatePreview();
            container.classList.remove('reordering');
        }, 150);
    }
}

function moveMediaToLast(index) {
    if (index < selectedFiles.length - 1) {
        const container = document.getElementById('mediaPreview');
        container.classList.add('reordering');
        
        // Move to last
        const item = selectedFiles.splice(index, 1)[0];
        selectedFiles.push(item);
        
        const itemCrop = cropData[index];
        delete cropData[index];
        
        // Rebuild crop indices
        const newCropData = {};
        const lastIndex = selectedFiles.length - 1;
        Object.keys(cropData).forEach(key => {
            const idx = parseInt(key);
            if (idx > index) {
                newCropData[idx - 1] = cropData[idx];
            } else {
                newCropData[idx] = cropData[idx];
            }
        });
        if (itemCrop) {
            newCropData[lastIndex] = itemCrop;
        }
        cropData = newCropData;
        
        // Update carousel index
        if (currentCarouselIndex === index) {
            currentCarouselIndex = lastIndex;
        } else if (currentCarouselIndex > index) {
            currentCarouselIndex--;
        }
        
        setTimeout(() => {
            displayMediaPreview();
            updatePreview();
            container.classList.remove('reordering');
        }, 150);
    }
}

function removeMedia(index) {
    selectedFiles.splice(index, 1);
    currentCarouselIndex = 0;
    displayMediaPreview();
    updatePreview();
}

function updatePreview() {
    const caption = document.getElementById('postCaption').value;
    const selectedDate = document.querySelector('.week-calendar-day.selected');
    const timePeriod = document.getElementById('timePeriod').value;
    const scheduledTimeInput = document.getElementById('scheduledTime').value;
    
    // Update caption preview smoothly
    const captionEl = document.getElementById('previewCaption');
    if (captionEl.textContent !== caption && caption.length > 0) {
        captionEl.textContent = caption;
    } else if (caption.length === 0) {
        captionEl.textContent = 'Your caption will appear here...';
    }
    
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
    
    // Update images preview with carousel
    const previewContainer = document.getElementById('previewImages');
    
    // Apply aspect ratio styling
    let aspectRatio = document.getElementById('aspectRatio').value;
    if (aspectRatio === 'custom') {
        const customRatio = document.getElementById('customAspectRatio').value;
        aspectRatio = customRatio || 'original';
    }
    selectedAspectRatio = aspectRatio;
    
    // Normalize aspect ratio for CSS
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    previewContainer.style.aspectRatio = normalizedRatio;
    
    if (selectedFiles.length > 0) {
        // Only show current image in carousel
        const currentFile = selectedFiles[currentCarouselIndex];
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Create canvas for preview, applying crop if it exists
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                if (cropData[currentCarouselIndex] && cropData[currentCarouselIndex].cropped) {
                    // Get current aspect ratio from dropdown
                    let aspectRatio = document.getElementById('aspectRatio').value;
                    if (aspectRatio === 'custom') {
                        const customRatio = document.getElementById('customAspectRatio').value;
                        aspectRatio = customRatio || '1:1';
                    }
                    
                    // Parse target aspect ratio
                    let targetRatio;
                    if (aspectRatio === 'original') {
                        targetRatio = img.width / img.height;
                    } else if (aspectRatio.includes(':')) {
                        const [w, h] = aspectRatio.split(':').map(parseFloat);
                        targetRatio = w / h;
                    } else {
                        targetRatio = parseFloat(aspectRatio);
                    }
                    
                    // Get stored center point
                    const centerX = cropData[currentCarouselIndex].centerX;
                    const centerY = cropData[currentCarouselIndex].centerY;
                    
                    // Calculate box dimensions based on current aspect ratio
                    let boxWidth, boxHeight;
                    const storedBoxWidth = cropData[currentCarouselIndex].boxWidth;
                    const storedBoxHeight = cropData[currentCarouselIndex].boxHeight;
                    
                    // Try to maximize crop area while maintaining aspect ratio
                    const possibleWidthFromHeight = storedBoxHeight * targetRatio;
                    const possibleHeightFromWidth = storedBoxWidth / targetRatio;
                    
                    if (possibleWidthFromHeight <= img.width) {
                        boxWidth = possibleWidthFromHeight;
                        boxHeight = storedBoxHeight;
                    } else if (possibleHeightFromWidth <= img.height) {
                        boxWidth = storedBoxWidth;
                        boxHeight = possibleHeightFromWidth;
                    } else {
                        // Scale down
                        if (storedBoxWidth / img.width > storedBoxHeight / img.height) {
                            boxWidth = storedBoxWidth;
                            boxHeight = boxWidth / targetRatio;
                        } else {
                            boxHeight = storedBoxHeight;
                            boxWidth = boxHeight * targetRatio;
                        }
                    }
                    
                    // Calculate crop position from center
                    const cropX = centerX - boxWidth / 2;
                    const cropY = centerY - boxHeight / 2;
                    
                    // Clamp to image bounds
                    const clampedX = Math.max(0, Math.min(cropX, img.width - boxWidth));
                    const clampedY = Math.max(0, Math.min(cropY, img.height - boxHeight));
                    const clampedW = Math.min(boxWidth, img.width - clampedX);
                    const clampedH = Math.min(boxHeight, img.height - clampedY);
                    
                    canvas.width = clampedW;
                    canvas.height = clampedH;
                    ctx.drawImage(img, clampedX, clampedY, clampedW, clampedH, 0, 0, clampedW, clampedH);
                } else {
                    // No crop, show full image
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                }
                
                // Update or create image smoothly
                let previewImg = previewContainer.querySelector('img');
                if (!previewImg) {
                    previewImg = document.createElement('img');
                    previewImg.style.width = '100%';
                    previewImg.style.height = '100%';
                    previewImg.style.objectFit = 'cover';
                    previewContainer.innerHTML = '';
                    previewContainer.appendChild(previewImg);
                }
                previewImg.src = canvas.toDataURL('image/jpeg');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(currentFile);
        
        // Show/hide carousel buttons and update indicators
        const carouselPrev = document.getElementById('carouselPrev');
        const carouselNext = document.getElementById('carouselNext');
        const indicatorsContainer = document.getElementById('carouselIndicators');
        
        if (selectedFiles.length > 1) {
            if (carouselPrev) carouselPrev.style.display = 'flex';
            if (carouselNext) carouselNext.style.display = 'flex';
            
            // Update only indicators that changed
            const indicators = indicatorsContainer.querySelectorAll('.carousel-indicator');
            
            // If count changed, rebuild
            if (indicators.length !== selectedFiles.length) {
                indicatorsContainer.innerHTML = '';
                selectedFiles.forEach((_, idx) => {
                    const indicator = document.createElement('div');
                    indicator.className = `carousel-indicator ${idx === currentCarouselIndex ? 'active' : ''}`;
                    indicator.addEventListener('click', () => {
                        currentCarouselIndex = idx;
                        updatePreview();
                    });
                    indicatorsContainer.appendChild(indicator);
                });
            } else {
                // Just update active state
                indicators.forEach((indicator, idx) => {
                    indicator.classList.toggle('active', idx === currentCarouselIndex);
                });
            }
        } else {
            if (carouselPrev) carouselPrev.style.display = 'none';
            if (carouselNext) carouselNext.style.display = 'none';
            indicatorsContainer.innerHTML = '';
        }
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

function navigateCarousel(direction) {
    if (selectedFiles.length <= 1) return;
    
    currentCarouselIndex += direction;
    
    // Wrap around
    if (currentCarouselIndex < 0) {
        currentCarouselIndex = selectedFiles.length - 1;
    } else if (currentCarouselIndex >= selectedFiles.length) {
        currentCarouselIndex = 0;
    }
    
    updatePreview();
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
    
    // Get aspect ratio info
    let aspectRatio = document.getElementById('aspectRatio').value;
    if (aspectRatio === 'custom') {
        const customRatio = document.getElementById('customAspectRatio').value;
        aspectRatio = customRatio || 'original';
    }
    
    // Apply crops to files that need cropping
    const formData = new FormData();
    formData.append('caption', caption);
    formData.append('scheduled_time', scheduledDateTime.toISOString());
    formData.append('status', status);
    formData.append('aspect_ratio', aspectRatio);
    
    // Process each file with crop data if available
    let filesProcessed = 0;
    let processComplete = false;
    
    const processFiles = async () => {
        for (let index = 0; index < selectedFiles.length; index++) {
            const file = selectedFiles[index];
            
            if (cropData[index] && cropData[index].cropped) {
                // Apply crop and get cropped blob
                const croppedBlob = await applyCropToFile(file, cropData[index]);
                const croppedFile = new File([croppedBlob], file.name, { type: 'image/jpeg' });
                formData.append('media', croppedFile);
            } else {
                // Use original file
                formData.append('media', file);
            }
        }
        
        // Send to backend
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
    };
    
    processFiles();
}

function applyCropToFile(file, cropData) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                canvas.width = cropData.width;
                canvas.height = cropData.height;
                ctx.drawImage(img, cropData.x, cropData.y, cropData.width, cropData.height, 0, 0, cropData.width, cropData.height);
                
                canvas.toBlob(resolve, 'image/jpeg', 0.95);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
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
    const aspectRatioSelect = document.getElementById('aspectRatio');
    const customAspectInput = document.getElementById('customAspectRatio');
    
    if (form) form.reset();
    selectedFiles = [];
    currentCarouselIndex = 0;
    selectedAspectRatio = 'original';
    cropData = {};
    if (mediaPreview) mediaPreview.innerHTML = '';
    if (previewImages) previewImages.innerHTML = '';
    if (previewCaption) previewCaption.textContent = 'Your caption will appear here...';
    if (previewDate) previewDate.textContent = 'Scheduled: --';
    if (captionCount) captionCount.textContent = '0';
    if (timePeriod) timePeriod.value = '';
    if (scheduledTime) scheduledTime.value = '';
    if (aspectRatioSelect) aspectRatioSelect.value = 'original';
    if (customAspectInput) {
        customAspectInput.value = '';
        customAspectInput.style.display = 'none';
    }
    
    // Reset carousel buttons
    const carouselPrev = document.getElementById('carouselPrev');
    const carouselNext = document.getElementById('carouselNext');
    const indicatorsContainer = document.getElementById('carouselIndicators');
    if (carouselPrev) carouselPrev.style.display = 'none';
    if (carouselNext) carouselNext.style.display = 'none';
    if (indicatorsContainer) indicatorsContainer.innerHTML = '';
    
    // Close crop modal if open
    const cropModal = document.getElementById('cropModal');
    if (cropModal) cropModal.style.display = 'none';
    
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

// Fetch Instagram Account ID from access token
async function fetchInstagramAccountId(e) {
    e.preventDefault();
    
    const accessToken = document.getElementById('accessToken').value;
    const fetchBtnText = document.getElementById('fetchBtnText');
    const fetchBtnSpinner = document.getElementById('fetchBtnSpinner');
    const fetchAccountIdBtn = document.getElementById('fetchAccountIdBtn');
    
    if (!accessToken) {
        showToast('Please enter an access token first', 'error');
        return;
    }
    
    try {
        console.log('=== FETCH ACCOUNT ID START ===');
        console.log('Access Token:', accessToken.substring(0, 20) + '...');
        
        // Show loading state
        fetchBtnText.style.display = 'none';
        fetchBtnSpinner.style.display = 'inline';
        fetchAccountIdBtn.disabled = true;
        
        const response = await apiCall('/instagram/fetch-account-id', {
            method: 'POST',
            body: JSON.stringify({
                access_token: accessToken
            }),
        });
        
        const data = await response.json();
        console.log('API Response Status:', response.status);
        console.log('API Response Data:', data);
        
        if (response.ok) {
            // Auto-populate the Instagram Account ID field
            const instagramAccountIdField = document.getElementById('instagramAccountId');
            instagramAccountIdField.value = data.instagram_account_id;
            
            showToast(`✅ Account ID fetched successfully!`, 'success');
            console.log('✅ Account ID populated:', data.instagram_account_id);
        } else {
            let errorMsg = data.error || data.message || 'Failed to fetch account ID';
            let errorDetails = data.details || '';
            
            console.error('❌ Fetch Error:', errorMsg);
            console.error('Error Details:', errorDetails);
            
            showErrorModal(
                'Failed to Fetch Account ID',
                errorMsg,
                errorDetails
            );
        }
    } catch (error) {
        console.error('❌ Fetch Exception:', error);
        console.error('Error Stack:', error.stack);
        showErrorModal(
            'Fetch Error',
            error.message || 'An unexpected error occurred',
            'Check the browser console (F12) for more details'
        );
    } finally {
        // Restore button state
        fetchBtnText.style.display = 'inline';
        fetchBtnSpinner.style.display = 'none';
        fetchAccountIdBtn.disabled = false;
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

// Crop Modal Functions
let cropState = {
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
    startLeft: 0,
    startTop: 0,
    isMoving: false,
    isResizing: false,
    resizeHandle: null,
    cropBox: null,
    imageData: null,
    imageWidth: 0,
    imageHeight: 0,
    originalAspectRatio: 1
};

function openCropModal(index) {
    currentCropIndex = index;
    const modal = document.getElementById('cropModal');
    const cropImage = document.getElementById('cropImage');
    const cropBox = document.getElementById('cropBox');
    
    // Load the image
    const reader = new FileReader();
    reader.onload = (e) => {
        cropImage.src = e.target.result;
        cropImage.onload = () => {
            setTimeout(() => {
                const container = document.querySelector('.crop-container');
                
                const imageWidth = cropImage.offsetWidth;
                const imageHeight = cropImage.offsetHeight;
                const imageLeft = cropImage.offsetLeft;
                const imageTop = cropImage.offsetTop;
                
                // Store original aspect ratio from the current image
                const currentImageAspectRatio = imageWidth / imageHeight;
                cropState.originalAspectRatio = currentImageAspectRatio;
                
                cropState.imageWidth = imageWidth;
                cropState.imageHeight = imageHeight;
                
                // Get the selected aspect ratio from the dropdown
                let aspectRatio = document.getElementById('aspectRatio').value;
                if (aspectRatio === 'custom') {
                    const customRatio = document.getElementById('customAspectRatio').value;
                    aspectRatio = customRatio || 'original';
                }
                
                // Determine the target aspect ratio (width / height)
                let targetRatio;
                if (aspectRatio === 'original') {
                    targetRatio = currentImageAspectRatio;
                    cropImage.style.aspectRatio = 'auto';
                } else {
                    // Normalize: "4:5" becomes 0.8, "1.91:1" becomes 1.91, etc.
                    if (aspectRatio.includes(':')) {
                        const [w, h] = aspectRatio.split(':').map(parseFloat);
                        targetRatio = w / h;
                    } else {
                        targetRatio = parseFloat(aspectRatio);
                    }
                    // Set image aspect ratio to match the selected ratio
                    cropImage.style.aspectRatio = targetRatio;
                }
                
                // Calculate the maximum crop box that fits the image with the selected aspect ratio
                let cropWidth, cropHeight;
                
                // Calculate maximum size while maintaining aspect ratio
                if (imageWidth / imageHeight > targetRatio) {
                    // Image is wider than aspect ratio, constrain by height
                    cropHeight = imageHeight;
                    cropWidth = cropHeight * targetRatio;
                } else {
                    // Image is taller than aspect ratio, constrain by width
                    cropWidth = imageWidth;
                    cropHeight = cropWidth / targetRatio;
                }
                
                // Center the crop box
                const cropLeft = imageLeft + (imageWidth - cropWidth) / 2;
                const cropTop = imageTop + (imageHeight - cropHeight) / 2;
                
                cropState.cropBox = {
                    x: cropLeft,
                    y: cropTop,
                    width: cropWidth,
                    height: cropHeight
                };
                
                // Check if there's already crop data for this image
                if (cropData[index] && cropData[index].cropped) {
                    // Restore previous crop settings from center point
                    const prevCropData = cropData[index];
                    const actualImageWidth = cropImage.naturalWidth;
                    const actualImageHeight = cropImage.naturalHeight;
                    const scaleX = imageWidth / actualImageWidth;
                    const scaleY = imageHeight / actualImageHeight;
                    
                    // Convert center point and dimensions from actual to displayed coordinates
                    const displayCenterX = prevCropData.centerX * scaleX;
                    const displayCenterY = prevCropData.centerY * scaleY;
                    const displayBoxWidth = prevCropData.boxWidth * scaleX;
                    const displayBoxHeight = prevCropData.boxHeight * scaleY;
                    
                    // Calculate corner position from center
                    const displayCropX = displayCenterX - displayBoxWidth / 2;
                    const displayCropY = displayCenterY - displayBoxHeight / 2;
                    
                    cropState.cropBox = {
                        x: imageLeft + displayCropX,
                        y: imageTop + displayCropY,
                        width: displayBoxWidth,
                        height: displayBoxHeight
                    };
                    
                    cropBox.style.left = (imageLeft + displayCropX) + 'px';
                    cropBox.style.top = (imageTop + displayCropY) + 'px';
                    cropBox.style.width = displayBoxWidth + 'px';
                    cropBox.style.height = displayBoxHeight + 'px';
                } else {
                    // Position crop box with default settings
                    cropBox.style.left = cropLeft + 'px';
                    cropBox.style.top = cropTop + 'px';
                    cropBox.style.width = cropWidth + 'px';
                    cropBox.style.height = cropHeight + 'px';
                }
                
                setupCropBoxListeners();
            }, 100);
        };
    };
    
    reader.readAsDataURL(selectedFiles[index]);
    modal.style.display = 'flex';
}

function setupCropBoxListeners() {
    const cropBox = document.getElementById('cropBox');
    const handles = document.querySelectorAll('.crop-handle');
    
    // Main crop box drag
    cropBox.addEventListener('mousedown', handleCropBoxMouseDown);
    
    // Handle resizing
    handles.forEach(handle => {
        handle.addEventListener('mousedown', handleHandleMouseDown);
    });
    
    // Global mouse events
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

function handleCropBoxMouseDown(e) {
    if (e.target.classList.contains('crop-handle')) return;
    
    cropState.isMoving = true;
    cropState.startX = e.clientX;
    cropState.startY = e.clientY;
    cropState.startLeft = cropState.cropBox.x;
    cropState.startTop = cropState.cropBox.y;
}

function handleHandleMouseDown(e) {
    e.preventDefault();
    cropState.isResizing = true;
    cropState.resizeHandle = e.target.className.match(/crop-handle-(.*)/)?.[1] || '';
    cropState.startX = e.clientX;
    cropState.startY = e.clientY;
    cropState.startWidth = cropState.cropBox.width;
    cropState.startHeight = cropState.cropBox.height;
    cropState.startLeft = cropState.cropBox.x;
    cropState.startTop = cropState.cropBox.y;
}

function handleMouseMove(e) {
    if (!cropState.isMoving && !cropState.isResizing) return;
    
    const cropBox = document.getElementById('cropBox');
    const container = document.querySelector('.crop-container');
    const cropImage = document.getElementById('cropImage');
    
    const deltaX = e.clientX - cropState.startX;
    const deltaY = e.clientY - cropState.startY;
    
    if (cropState.isMoving) {
        // Move the crop box
        let newX = cropState.startLeft + deltaX;
        let newY = cropState.startTop + deltaY;
        
        // Constrain within image
        const imageLeft = cropImage.offsetLeft;
        const imageTop = cropImage.offsetTop;
        const maxX = imageLeft + cropState.imageWidth - cropState.cropBox.width;
        const maxY = imageTop + cropState.imageHeight - cropState.cropBox.height;
        
        newX = Math.max(imageLeft, Math.min(newX, maxX));
        newY = Math.max(imageTop, Math.min(newY, maxY));
        
        cropBox.style.left = newX + 'px';
        cropBox.style.top = newY + 'px';
        
        cropState.cropBox.x = newX;
        cropState.cropBox.y = newY;
    } else if (cropState.isResizing) {
        // Resize the crop box
        let newWidth = cropState.startWidth;
        let newHeight = cropState.startHeight;
        let newX = cropState.startLeft;
        let newY = cropState.startTop;
        
        const handle = cropState.resizeHandle;
        const minSize = 50;
        
        // Get aspect ratio for resize constraint
        let aspectRatio = document.getElementById('aspectRatio').value;
        if (aspectRatio === 'custom') {
            const customRatio = document.getElementById('customAspectRatio').value;
            aspectRatio = customRatio || '1:1';
        }
        
        let targetRatio;
        if (aspectRatio === 'original') {
            targetRatio = cropState.originalAspectRatio;
        } else {
            targetRatio = parseFloat(normalizeAspectRatio(aspectRatio));
        }
        
        // Resize based on handle
        if (handle.includes('e')) {
            newWidth = Math.max(minSize, cropState.startWidth + deltaX);
        }
        if (handle.includes('s')) {
            newHeight = Math.max(minSize, cropState.startHeight + deltaY);
        }
        if (handle.includes('w')) {
            newWidth = Math.max(minSize, cropState.startWidth - deltaX);
            newX = cropState.startLeft + deltaX;
        }
        if (handle.includes('n')) {
            newHeight = Math.max(minSize, cropState.startHeight - deltaY);
            newY = cropState.startTop + deltaY;
        }
        
        // Maintain aspect ratio
        if (handle.includes('e') || handle.includes('w')) {
            newHeight = newWidth / targetRatio;
        } else if (handle.includes('s') || handle.includes('n')) {
            newWidth = newHeight * targetRatio;
        }
        
        // Constrain within image
        const imageLeft = cropImage.offsetLeft;
        const imageTop = cropImage.offsetTop;
        const imageRight = imageLeft + cropState.imageWidth;
        const imageBottom = imageTop + cropState.imageHeight;
        
        // Ensure crop box stays within image
        if (newX < imageLeft) {
            newX = imageLeft;
            newWidth = Math.min(newWidth, imageRight - newX);
        }
        if (newY < imageTop) {
            newY = imageTop;
            newHeight = Math.min(newHeight, imageBottom - newY);
        }
        if (newX + newWidth > imageRight) {
            newWidth = imageRight - newX;
            newHeight = newWidth / targetRatio;
        }
        if (newY + newHeight > imageBottom) {
            newHeight = imageBottom - newY;
            newWidth = newHeight * targetRatio;
        }
        
        cropBox.style.width = newWidth + 'px';
        cropBox.style.height = newHeight + 'px';
        cropBox.style.left = newX + 'px';
        cropBox.style.top = newY + 'px';
        
        cropState.cropBox.width = newWidth;
        cropState.cropBox.height = newHeight;
        cropState.cropBox.x = newX;
        cropState.cropBox.y = newY;
    }
}

function handleMouseUp() {
    cropState.isMoving = false;
    cropState.isResizing = false;
    cropState.resizeHandle = null;
}

function closeCropModal() {
    const modal = document.getElementById('cropModal');
    modal.style.display = 'none';
    currentCropIndex = null;
    
    // Remove event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
    // Reset crop state
    cropState = {
        startX: 0,
        startY: 0,
        startWidth: 0,
        startHeight: 0,
        startLeft: 0,
        startTop: 0,
        isMoving: false,
        isResizing: false,
        resizeHandle: null,
        cropBox: null,
        imageData: null,
        imageWidth: 0,
        imageHeight: 0,
        originalAspectRatio: 1
    };
}

function applyCrop() {
    if (currentCropIndex === null || !cropState.cropBox) return;
    
    const cropImage = document.getElementById('cropImage');
    const cropBox = document.getElementById('cropBox');
    
    // Get the original image file and load it fresh to get accurate dimensions
    const file = selectedFiles[currentCropIndex];
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            // Get actual image dimensions
            const actualImageWidth = img.width;
            const actualImageHeight = img.height;
            
            // Get displayed image dimensions
            const displayWidth = cropImage.offsetWidth;
            const displayHeight = cropImage.offsetHeight;
            
            // Calculate scale ratios (displayed size -> actual file size)
            const scaleX = actualImageWidth / displayWidth;
            const scaleY = actualImageHeight / displayHeight;
            
            // Get crop box position and size
            const cropBoxRect = cropBox.getBoundingClientRect();
            const cropImageRect = cropImage.getBoundingClientRect();
            
            // Calculate crop box center in actual image coordinates
            const relativeLeft = cropBoxRect.left - cropImageRect.left;
            const relativeTop = cropBoxRect.top - cropImageRect.top;
            const cropBoxWidth = cropBoxRect.width;
            const cropBoxHeight = cropBoxRect.height;
            
            // Calculate center point in actual image coordinates
            const centerX = (relativeLeft + cropBoxWidth / 2) * scaleX;
            const centerY = (relativeTop + cropBoxHeight / 2) * scaleY;
            const boxWidth = cropBoxWidth * scaleX;
            const boxHeight = cropBoxHeight * scaleY;
            
            // Store only the center point and size, not individual corners
            if (!cropData[currentCropIndex]) {
                cropData[currentCropIndex] = {};
            }
            cropData[currentCropIndex].cropped = true;
            cropData[currentCropIndex].centerX = centerX;
            cropData[currentCropIndex].centerY = centerY;
            cropData[currentCropIndex].boxWidth = boxWidth;
            cropData[currentCropIndex].boxHeight = boxHeight;
            
            console.log('Crop data saved (center-based):', cropData[currentCropIndex]);
            
            // Update previews
            displayMediaPreview();
            updatePreview();
            
            // Close modal
            closeCropModal();
            showToast('Image cropped successfully', 'success');
        };
        img.src = e.target.result;
    };
    
    reader.readAsDataURL(file);
}

function saveCropData() {
    // Save the current crop box to cropData without closing the modal
    if (currentCropIndex === null || !cropState.cropBox) return;
    
    const cropImage = document.getElementById('cropImage');
    const cropBox = document.getElementById('cropBox');
    
    // Get the original image file and load it fresh to get accurate dimensions
    const file = selectedFiles[currentCropIndex];
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            // Get actual image dimensions
            const actualImageWidth = img.width;
            const actualImageHeight = img.height;
            
            // Get displayed image dimensions
            const displayWidth = cropImage.offsetWidth;
            const displayHeight = cropImage.offsetHeight;
            
            // Calculate scale ratios (displayed size -> actual file size)
            const scaleX = actualImageWidth / displayWidth;
            const scaleY = actualImageHeight / displayHeight;
            
            // Get crop box position and size
            const cropBoxRect = cropBox.getBoundingClientRect();
            const cropImageRect = cropImage.getBoundingClientRect();
            
            // Calculate crop box center in actual image coordinates
            const relativeLeft = cropBoxRect.left - cropImageRect.left;
            const relativeTop = cropBoxRect.top - cropImageRect.top;
            const cropBoxWidth = cropBoxRect.width;
            const cropBoxHeight = cropBoxRect.height;
            
            // Calculate center point in actual image coordinates
            const centerX = (relativeLeft + cropBoxWidth / 2) * scaleX;
            const centerY = (relativeTop + cropBoxHeight / 2) * scaleY;
            const boxWidth = cropBoxWidth * scaleX;
            const boxHeight = cropBoxHeight * scaleY;
            
            // Store only the center point and size, not individual corners
            if (!cropData[currentCropIndex]) {
                cropData[currentCropIndex] = {};
            }
            cropData[currentCropIndex].cropped = true;
            cropData[currentCropIndex].centerX = centerX;
            cropData[currentCropIndex].centerY = centerY;
            cropData[currentCropIndex].boxWidth = boxWidth;
            cropData[currentCropIndex].boxHeight = boxHeight;
            
            console.log('Crop data saved (center-based, modal open):', cropData[currentCropIndex]);
            
            // Update previews
            displayMediaPreview();
            updatePreview();
            
            // Modal stays open - user can continue editing
        };
        img.src = e.target.result;
    };
    
    reader.readAsDataURL(file);
}

// ASPECT RATIO FEATURE DISABLED - TODO: Fix aspect ratio switching issues
// Aspect Ratio Handler - Currently disabled, defaulted to 'original'
/*
function handleAspectRatioChange(e) {
    const value = e.target.value;
    console.log('Aspect ratio changed to:', value);
    const customInput = document.getElementById('customAspectRatio');
    
    if (value === 'custom') {
        customInput.style.display = 'block';
    } else {
        customInput.style.display = 'none';
        customInput.value = '';
    }
    
    selectedAspectRatio = value;
    
    // If crop modal is open, update the crop box with new aspect ratio and save the crop
    const cropModal = document.getElementById('cropModal');
    const isModalOpen = cropModal && cropModal.style.display === 'flex';
    console.log('Crop modal status - is open:', isModalOpen, 'currentCropIndex:', currentCropIndex);
    
    if (isModalOpen && currentCropIndex !== null) {
        console.log('Calling updateCropBoxAspectRatio...');
        updateCropBoxAspectRatio();
        // Automatically save the updated crop to cropData without closing the modal
        console.log('Auto-saving crop after aspect ratio change...');
        setTimeout(() => saveCropData(), 100);
        return; // Don't call displayMediaPreview/updatePreview here, saveCropData will do it
    }
    
    displayMediaPreview();
    updatePreview();
}
*/

// ASPECT RATIO FEATURE DISABLED - Commenting out updateCropBoxAspectRatio function
/*
function updateCropBoxAspectRatio() {
    console.log('updateCropBoxAspectRatio called');
    const cropImage = document.getElementById('cropImage');
    const cropBox = document.getElementById('cropBox');
    
    if (!cropImage.src || currentCropIndex === null) {
        console.log('Exiting: missing cropImage.src or currentCropIndex');
        return;
    }
    
    // Get new aspect ratio from dropdown
    let aspectRatio = document.getElementById('aspectRatio').value;
    if (aspectRatio === 'custom') {
        const customRatio = document.getElementById('customAspectRatio').value;
        aspectRatio = customRatio || '1:1';
    }
    
    // Determine the target aspect ratio (width / height)
    let targetRatio;
    if (aspectRatio === 'original') {
        targetRatio = cropState.originalAspectRatio;
        cropImage.style.aspectRatio = 'auto';
    } else {
        if (aspectRatio.includes(':')) {
            const [w, h] = aspectRatio.split(':').map(parseFloat);
            targetRatio = w / h;
        } else {
            targetRatio = parseFloat(aspectRatio);
        }
        cropImage.style.aspectRatio = targetRatio;
    }
    
    // Wait for layout to update after aspect ratio change
    requestAnimationFrame(() => {
        // Get updated image dimensions after aspect ratio change
        const imageWidth = cropImage.offsetWidth;
        const imageHeight = cropImage.offsetHeight;
        const imageLeft = cropImage.offsetLeft;
        const imageTop = cropImage.offsetTop;
        const actualImageWidth = cropImage.naturalWidth;
        const actualImageHeight = cropImage.naturalHeight;
        
        console.log('Image dimensions after ratio change:', { imageWidth, imageHeight, actualImageWidth, actualImageHeight });
        
        // Calculate scale from actual to displayed coordinates
        const scaleX = imageWidth / actualImageWidth;
        const scaleY = imageHeight / actualImageHeight;
        
        // Get the crop center and size in actual image file coordinates (source of truth)
        let centerActualX, centerActualY, boxActualW, boxActualH;
        
        if (cropData[currentCropIndex] && cropData[currentCropIndex].cropped) {
            // Use stored crop data from file (center-based, most reliable)
            centerActualX = cropData[currentCropIndex].centerX;
            centerActualY = cropData[currentCropIndex].centerY;
            boxActualW = cropData[currentCropIndex].boxWidth;
            boxActualH = cropData[currentCropIndex].boxHeight;
            console.log('Using stored center-based crop data from file');
        } else if (cropState.cropBox) {
            // Convert current displayed crop box back to actual image coordinates
            const displayCropCenterX = (cropState.cropBox.x - imageLeft) + cropState.cropBox.width / 2;
            const displayCropCenterY = (cropState.cropBox.y - imageTop) + cropState.cropBox.height / 2;
            centerActualX = displayCropCenterX / scaleX;
            centerActualY = displayCropCenterY / scaleY;
            boxActualW = cropState.cropBox.width / scaleX;
            boxActualH = cropState.cropBox.height / scaleY;
            console.log('Converting displayed crop box to actual coordinates');
        } else {
            // No crop data, use full image center
            centerActualX = actualImageWidth / 2;
            centerActualY = actualImageHeight / 2;
            boxActualW = actualImageWidth;
            boxActualH = actualImageHeight;
            console.log('Using full image as crop area');
        }
        
        // Clamp to actual image bounds
        centerActualX = Math.max(0, Math.min(centerActualX, actualImageWidth));
        centerActualY = Math.max(0, Math.min(centerActualY, actualImageHeight));
        boxActualW = Math.max(0, Math.min(boxActualW, actualImageWidth));
        boxActualH = Math.max(0, Math.min(boxActualH, actualImageHeight));
        
        // Adjust the crop to match the new aspect ratio while preserving as much as possible
        let newBoxW, newBoxH;
        
        const possibleWFromH = boxActualH * targetRatio;
        const possibleHFromW = boxActualW / targetRatio;
        
        // Try to keep as much of the crop area as possible
        if (possibleWFromH <= actualImageWidth) {
            // Can use current height with new width
            newBoxW = possibleWFromH;
            newBoxH = boxActualH;
        } else if (possibleHFromW <= actualImageHeight) {
            // Can use current width with new height
            newBoxW = boxActualW;
            newBoxH = possibleHFromW;
        } else {
            // Need to scale down - pick the best fit
            if (boxActualW / actualImageWidth > boxActualH / actualImageHeight) {
                // Width is more constrained
                newBoxW = boxActualW;
                newBoxH = newBoxW / targetRatio;
            } else {
                // Height is more constrained
                newBoxH = boxActualH;
                newBoxW = newBoxH * targetRatio;
            }
        }
        
        // Position centered at the same location
        let newCenterActualX = centerActualX;
        let newCenterActualY = centerActualY;
        
        // Clamp to image bounds to ensure crop stays in bounds
        const cropLeftBound = newBoxW / 2;
        const cropRightBound = actualImageWidth - newBoxW / 2;
        const cropTopBound = newBoxH / 2;
        const cropBottomBound = actualImageHeight - newBoxH / 2;
        
        newCenterActualX = Math.max(cropLeftBound, Math.min(newCenterActualX, cropRightBound));
        newCenterActualY = Math.max(cropTopBound, Math.min(newCenterActualY, cropBottomBound));
        
        // Convert back to displayed coordinates
        const displayCenterX = imageLeft + newCenterActualX * scaleX;
        const displayCenterY = imageTop + newCenterActualY * scaleY;
        const displayBoxW = newBoxW * scaleX;
        const displayBoxH = newBoxH * scaleY;
        const displayCropX = displayCenterX - displayBoxW / 2;
        const displayCropY = displayCenterY - displayBoxH / 2;
        
        console.log('New crop (center-based):', { centerActualX, centerActualY, newBoxW, newBoxH }, '-> displayed:', { displayCropX, displayCropY, displayBoxW, displayBoxH });
        
        // Update crop state
        cropState.cropBox = {
            x: displayCropX,
            y: displayCropY,
            width: displayBoxW,
            height: displayBoxH
        };
        
        // Update crop box DOM element
        cropBox.style.left = displayCropX + 'px';
        cropBox.style.top = displayCropY + 'px';
        cropBox.style.width = displayBoxW + 'px';
        cropBox.style.height = displayBoxH + 'px';
        
        console.log('Crop box updated');
    });
}*/