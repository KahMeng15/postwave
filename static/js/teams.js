// Teams Management Functions

async function setupAdmin(e) {
    e.preventDefault();
    
    const name = document.getElementById('setupName').value;
    const email = document.getElementById('setupEmail').value;
    const password = document.getElementById('setupPassword').value;
    const confirmPassword = document.getElementById('setupConfirmPassword').value;
    
    if (password !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }
    
    try {
        const response = await apiCall('/teams/setup-admin', {
            method: 'POST',
            body: JSON.stringify({
                name,
                email,
                password
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Super admin account created! Logging in...', 'success');
            
            // Auto-login with the credentials
            setTimeout(() => {
                handleLogin({
                    preventDefault: () => {},
                    target: {
                        elements: {
                            username: { value: username },
                            password: { value: password }
                        }
                    }
                });
            }, 1000);
        } else {
            showToast(data.error || 'Failed to create super admin', 'error');
        }
    } catch (error) {
        console.error('Setup error:', error);
        showToast('An error occurred during setup', 'error');
    }
}

// Teams CRUD Operations
async function loadTeams() {
    try {
        const response = await apiCall('/teams/teams');
        const data = await response.json();
        
        if (response.ok) {
            displayTeams(data.teams);
        } else {
            showToast('Failed to load teams', 'error');
        }
    } catch (error) {
        console.error('Failed to load teams:', error);
        showToast('Failed to load teams', 'error');
    }
}

function displayTeams(teams) {
    const container = document.getElementById('teamsContainer');
    
    if (!container) return;
    
    if (teams.length === 0) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999;">No teams yet. Create one to get started!</p>';
        return;
    }
    
    container.innerHTML = teams.map(team => `
        <div class="team-card" onclick="selectTeam(${team.id})">
            <h3>${team.name}</h3>
            <p>${team.description || 'No description'}</p>
            <div class="team-info">
                <span class="team-members-count">${team.members?.length || 0} members</span>
                <span>${team.instagram_connected ? '✅ Instagram Connected' : '⚠️ Not Connected'}</span>
            </div>
            <div class="team-actions">
                <button type="button" class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openMembersModal(${team.id})">Manage Members</button>
                <button type="button" class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); editTeam(${team.id})">Edit</button>
            </div>
        </div>
    `).join('');
}

function openTeamModal() {
    document.getElementById('teamForm').reset();
    document.getElementById('teamModalTitle').textContent = 'Create Team';
    document.getElementById('teamModal').style.display = 'block';
}

function closeTeamModal() {
    document.getElementById('teamModal').style.display = 'none';
}

async function handleTeamSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('teamName').value;
    const description = document.getElementById('teamDescription').value;
    
    try {
        const response = await apiCall('/teams/teams', {
            method: 'POST',
            body: JSON.stringify({ name, description })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Team created successfully!', 'success');
            closeTeamModal();
            loadTeams();
        } else {
            showToast(data.error || 'Failed to create team', 'error');
        }
    } catch (error) {
        console.error('Failed to create team:', error);
        showToast('Failed to create team', 'error');
    }
}

function selectTeam(teamId) {
    // Open team details (can be expanded later)
    console.log('Selected team:', teamId);
}

function editTeam(teamId) {
    // Placeholder for team editing
    showToast('Edit team feature coming soon', 'info');
}

// Members Management
async function openMembersModal(teamId) {
    window.currentTeamId = teamId;
    
    try {
        const response = await apiCall(`/teams/teams/${teamId}/members`);
        const data = await response.json();
        
        if (response.ok) {
            displayMembers(data.members);
            document.getElementById('membersModal').style.display = 'block';
        } else {
            showToast('Failed to load team members', 'error');
        }
    } catch (error) {
        console.error('Failed to load members:', error);
        showToast('Failed to load team members', 'error');
    }
}

function closeMembersModal() {
    document.getElementById('membersModal').style.display = 'none';
}

function displayMembers(members) {
    const container = document.getElementById('membersContainer');
    
    if (!container) return;
    
    if (members.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No members yet</p>';
        return;
    }
    
    container.innerHTML = `
        <div class="members-list">
            ${members.map(member => `
                <div class="member-item">
                    <div class="member-info">
                        <div class="member-name">${member.username}</div>
                        <div class="member-role">${member.role === 'leader' ? '👑 Team Leader' : '👤 Team Member'}</div>
                        ${member.requires_approval ? '<div class="member-role" style="color: #ff6b6b;">⚠️ Requires Approval</div>' : ''}
                    </div>
                    <div class="member-actions">
                        <button type="button" class="btn btn-xs btn-secondary" onclick="editMember(${window.currentTeamId}, ${member.user_id})">Edit</button>
                        <button type="button" class="btn btn-xs btn-danger" onclick="removeMember(${window.currentTeamId}, ${member.user_id})">Remove</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function openInviteModal() {
    document.getElementById('inviteForm').reset();
    document.getElementById('inviteModal').style.display = 'block';
}

function closeInviteModal() {
    document.getElementById('inviteModal').style.display = 'none';
}

async function handleInviteSubmit(e) {
    e.preventDefault();
    
    const email = document.getElementById('inviteEmail').value;
    const role = document.getElementById('inviteRole').value;
    const requires_approval = document.getElementById('inviteRequiresApproval').checked;
    
    try {
        const response = await apiCall('/teams/invite', {
            method: 'POST',
            body: JSON.stringify({
                email,
                team_id: window.currentTeamId,
                role,
                requires_approval
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast(data.existing_user ? `${email} added to team!` : `Invitation sent to ${email}!`, 'success');
            closeInviteModal();
            openMembersModal(window.currentTeamId);
        } else {
            showToast(data.error || 'Failed to send invite', 'error');
        }
    } catch (error) {
        console.error('Failed to send invite:', error);
        showToast('Failed to send invite', 'error');
    }
}

async function removeMember(teamId, userId) {
    if (!confirm('Are you sure you want to remove this member?')) return;
    
    try {
        const response = await apiCall(`/teams/teams/${teamId}/members/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('Member removed', 'success');
            openMembersModal(teamId);
        } else {
            showToast(data.error || 'Failed to remove member', 'error');
        }
    } catch (error) {
        console.error('Failed to remove member:', error);
        showToast('Failed to remove member', 'error');
    }
}

function editMember(teamId, userId) {
    // Placeholder for member editing
    showToast('Edit member feature coming soon', 'info');
}

// Initialize teams view
function initializeTeamsView() {
    const createTeamBtn = document.getElementById('createTeamBtn');
    const teamForm = document.getElementById('teamForm');
    const inviteMemberBtn = document.getElementById('inviteMemberBtn');
    const inviteForm = document.getElementById('inviteForm');
    const setupForm = document.getElementById('setupForm');
    
    if (createTeamBtn) createTeamBtn.addEventListener('click', openTeamModal);
    if (teamForm) teamForm.addEventListener('submit', handleTeamSubmit);
    if (inviteMemberBtn) inviteMemberBtn.addEventListener('click', openInviteModal);
    if (inviteForm) inviteForm.addEventListener('submit', handleInviteSubmit);
    if (setupForm) setupForm.addEventListener('submit', setupAdmin);
    
    loadTeams();
}
