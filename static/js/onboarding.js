// Onboarding Wizard Module
const onboardingModule = {
    currentStep: 1,
    setupData: {},

    async init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Step 1: Admin Setup
        const adminSetupForm = document.getElementById('adminSetupForm');
        if (adminSetupForm) {
            adminSetupForm.addEventListener('submit', (e) => this.handleAdminSetup(e));
        }

        // Step 2: SMTP Setup
        const smtpSetupForm = document.getElementById('smtpSetupForm');
        if (smtpSetupForm) {
            smtpSetupForm.addEventListener('submit', (e) => this.handleSmtpSetup(e));
        }
        const skipSmtp = document.getElementById('skipSmtp');
        if (skipSmtp) {
            skipSmtp.addEventListener('click', () => this.nextStep());
        }

        // Step 3: URL Setup
        const urlSetupForm = document.getElementById('urlSetupForm');
        if (urlSetupForm) {
            urlSetupForm.addEventListener('submit', (e) => this.handleUrlSetup(e));
        }
        const skipUrl = document.getElementById('skipUrl');
        if (skipUrl) {
            skipUrl.addEventListener('click', () => this.nextStep());
        }

        // Step 4: Team Setup
        const teamSetupForm = document.getElementById('teamSetupForm');
        if (teamSetupForm) {
            teamSetupForm.addEventListener('submit', (e) => this.handleTeamSetup(e));
        }

        // Completion
        const goToDashboard = document.getElementById('goToDashboard');
        if (goToDashboard) {
            goToDashboard.addEventListener('click', () => {
                console.log('Go to Dashboard button clicked');
                navigateTo('/dashboard');
            });
        }
    },

    async handleAdminSetup(e) {
        e.preventDefault();

        const name = document.getElementById('adminName').value;
        const email = document.getElementById('adminEmail').value;
        const password = document.getElementById('adminPassword').value;
        const confirmPassword = document.getElementById('adminPasswordConfirm').value;

        if (password !== confirmPassword) {
            showToast('Passwords do not match', 'error');
            return;
        }

        if (password.length < 6) {
            showToast('Password must be at least 6 characters', 'error');
            return;
        }

        try {
            const response = await apiCall('/teams/setup-admin', {
                method: 'POST',
                body: JSON.stringify({ email, name, password }),
                skipAuth: true,
            });

            const data = await response.json();

            if (response.ok) {
                console.log('Setup admin response data:', data);
                this.setupData.admin = { email, name, password };
                
                if (!data.access_token) {
                    console.error('ERROR: No access_token in response!', data);
                    showToast('Setup response missing authentication token', 'error');
                    return;
                }
                
                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('refresh_token', data.refresh_token);
                console.log('Token saved to localStorage');
                
                currentUser = data.user;
                showToast('Super admin account created!', 'success');
                this.nextStep();
            } else {
                showToast(data.error || 'Setup failed', 'error');
            }
        } catch (error) {
            showToast('An error occurred during setup', 'error');
            console.error(error);
        }
    },

    async handleSmtpSetup(e) {
        e.preventDefault();

        const mailServer = document.getElementById('mailServer').value;
        const mailPort = document.getElementById('mailPort').value;
        const mailUseTls = document.getElementById('mailUseTls').checked;
        const mailUsername = document.getElementById('mailUsername').value;
        const mailPassword = document.getElementById('mailPassword').value;
        const mailFromEmail = document.getElementById('mailFromEmail').value;
        const mailFromName = document.getElementById('mailFromName').value;

        // Verify we have an access token
        const token = localStorage.getItem('access_token');
        if (!token) {
            console.error('ERROR: No access token found! Step 1 (admin setup) must be completed first.');
            showToast('Authentication required - please complete admin setup first', 'error');
            return;
        }

        const payload = {
            mail_server: mailServer,
            mail_port: parseInt(mailPort),
            mail_use_tls: mailUseTls,
            mail_username: mailUsername,
            mail_password: mailPassword,
            mail_from_email: mailFromEmail,
            mail_from_name: mailFromName,
        };

        console.log('Email setup payload:', payload);
        console.log('Using access token:', token.substring(0, 20) + '...');

        try {
            const response = await apiCall('/settings/email', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            console.log('Email setup response:', response.status, data);

            if (response.ok) {
                this.setupData.smtp = { mailServer, mailPort, mailUseTls, mailUsername, mailFromEmail, mailFromName };
                showToast('Email configuration saved!', 'success');
                this.nextStep();
            } else {
                const errorMsg = data.error || data.message || `Server error: ${response.status}`;
                console.error('Email setup error:', errorMsg);
                showToast(errorMsg, 'error');
            }
        } catch (error) {
            console.error('Email setup exception:', error);
            showToast('An error occurred while saving email settings: ' + error.message, 'error');
        }
    },

    async handleUrlSetup(e) {
        e.preventDefault();

        const appUrl = document.getElementById('appUrl').value;

        try {
            const response = await apiCall('/settings/app-url', {
                method: 'POST',
                body: JSON.stringify({ app_url: appUrl }),
            });

            const data = await response.json();

            if (response.ok) {
                this.setupData.url = { appUrl };
                showToast('Application URL configured!', 'success');
                this.nextStep();
            } else {
                showToast(data.error || data.message || 'Failed to save URL settings', 'error');
            }
        } catch (error) {
            showToast('An error occurred while saving URL settings: ' + error.message, 'error');
            console.error(error);
        }
    },

    async handleTeamSetup(e) {
        e.preventDefault();

        const teamName = document.getElementById('teamName').value;
        const teamDescription = document.getElementById('teamDescription').value || '';

        try {
            const response = await apiCall('/teams/teams', {
                method: 'POST',
                body: JSON.stringify({
                    name: teamName,
                    description: teamDescription,
                }),
            });

            const data = await response.json();

            if (response.ok) {
                this.setupData.team = { teamName, teamDescription };
                showToast('First team created!', 'success');
                console.log('Team created successfully, moving to completion');
                this.complete();  // Call complete() instead of nextStep() to finish onboarding
            } else {
                showToast(data.error || data.message || 'Failed to create team', 'error');
            }
        } catch (error) {
            showToast('An error occurred while creating team: ' + error.message, 'error');
            console.error(error);
        }
    },

    nextStep() {
        // Hide current step
        const currentElement = document.getElementById(`step${this.currentStep}`);
        if (currentElement) {
            currentElement.classList.remove('active');
            currentElement.style.display = 'none';
        }

        this.currentStep++;

        // Show next step
        const nextElement = document.getElementById(`step${this.currentStep}`);
        if (nextElement) {
            nextElement.classList.add('active');
            nextElement.style.display = 'block';
        }
    },

    complete() {
        // Show completion screen
        const currentElement = document.getElementById(`step${this.currentStep}`);
        if (currentElement) {
            currentElement.classList.remove('active');
            currentElement.style.display = 'none';
        }

        const completionElement = document.getElementById('completionScreen');
        if (completionElement) {
            completionElement.classList.add('active');
            completionElement.style.display = 'block';
        }

        // Redirect to dashboard after 3 seconds
        setTimeout(() => {
            navigateTo('/dashboard');
        }, 3000);
    }
};
