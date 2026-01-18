from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Team, TeamMember, ActivityLog, Invitation, Post
from datetime import datetime, timedelta
import logging
import secrets
from functools import wraps

logger = logging.getLogger(__name__)
team_settings_bp = Blueprint('team_settings', __name__, url_prefix='/api/team-settings')


def log_activity(user_id, action_type, description, resource_type=None, resource_id=None, metadata=None, team_id=None):
    """Helper function to log activities"""
    try:
        log_entry = ActivityLog(
            team_id=team_id,
            user_id=user_id,
            action_type=action_type,
            description=description,
            resource_type=resource_type,
            resource_id=resource_id,
            extra_data=metadata,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent', '')
        )
        db.session.add(log_entry)
        db.session.commit()
    except Exception as e:
        logger.error(f'Failed to log activity: {str(e)}')


def get_user_team_role(user_id, team_id):
    """Get user's role in a team"""
    membership = TeamMember.query.filter_by(user_id=user_id, team_id=team_id).first()
    return membership.role if membership else None


def require_team_role(*allowed_roles):
    """Decorator to check if user has required role in team"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            current_user_id = int(get_jwt_identity())
            team_id = request.view_args.get('team_id')
            
            if not team_id:
                return jsonify({'error': 'Team ID required'}), 400
            
            role = get_user_team_role(current_user_id, team_id)
            
            if not role:
                return jsonify({'error': 'Not a member of this team'}), 403
            
            if allowed_roles and role not in allowed_roles:
                return jsonify({'error': f'Insufficient permissions - requires {allowed_roles}'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ==================== TEAM INFO ====================

@team_settings_bp.route('/<int:team_id>', methods=['GET'])
@jwt_required()
@require_team_role()  # Any team member can view
def get_team_settings(team_id):
    """Get team settings"""
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        return jsonify({
            'id': team.id,
            'name': team.name,
            'description': team.description,
            'instagram_username': team.instagram_username,
            'instagram_connected': bool(team.instagram_account_id),
            'created_at': team.created_at.isoformat()
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get team settings: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get team settings'}), 500


# ==================== INSTAGRAM API SETTINGS ====================

@team_settings_bp.route('/<int:team_id>/instagram', methods=['GET'])
@jwt_required()
@require_team_role('owner', 'manager')  # Only owner/manager can view API settings
def get_instagram_settings(team_id):
    """Get Instagram API settings for team"""
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        current_user_id = int(get_jwt_identity())
        
        return jsonify({
            'instagram_username': team.instagram_username,
            'instagram_profile_picture': team.instagram_profile_picture,
            'instagram_connected': bool(team.instagram_account_id),
            'token_expires_at': team.token_expires_at.isoformat() if team.token_expires_at else None
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get Instagram settings: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get Instagram settings'}), 500


@team_settings_bp.route('/<int:team_id>/instagram/disconnect', methods=['POST'])
@jwt_required()
@require_team_role('owner', 'manager')  # Only owner/manager can disconnect
def disconnect_instagram(team_id):
    """Disconnect Instagram account from team"""
    current_user_id = int(get_jwt_identity())
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        old_username = team.instagram_username
        team.instagram_account_id = None
        team.instagram_access_token = None
        team.instagram_username = None
        team.instagram_profile_picture = None
        team.token_expires_at = None
        db.session.commit()
        
        log_activity(
            current_user_id,
            'instagram_disconnected',
            f'Disconnected Instagram account {old_username} from team',
            resource_type='team',
            resource_id=team_id,
            team_id=team_id
        )
        
        return jsonify({'message': 'Instagram account disconnected'}), 200
    
    except Exception as e:
        logger.error(f'Failed to disconnect Instagram: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to disconnect Instagram'}), 500


@team_settings_bp.route('/<int:team_id>/instagram/fetch-profile-picture', methods=['POST'])
@jwt_required()
@require_team_role('owner', 'manager')
def fetch_team_profile_picture(team_id):
    """Fetch and update team's Instagram profile picture"""
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        if not team.instagram_account_id or not team.instagram_access_token:
            return jsonify({'error': 'Instagram not connected'}), 400
        
        from instagram_api import InstagramAPI
        ig_api = InstagramAPI()
        
        # Fetch account info including profile picture
        account_info = ig_api.get_account_info(team.instagram_account_id, team.instagram_access_token)
        
        if account_info and account_info.get('profile_picture_url'):
            team.instagram_profile_picture = account_info['profile_picture_url']
            db.session.commit()
            return jsonify({
                'instagram_profile_picture': team.instagram_profile_picture,
                'message': 'Profile picture fetched successfully'
            }), 200
        else:
            return jsonify({'error': 'Could not fetch profile picture from Instagram'}), 400
    
    except Exception as e:
        error_msg = str(e)
        logger.error(f'Failed to fetch profile picture: {error_msg}', exc_info=True)
        return jsonify({'error': f'Failed to fetch profile picture: {error_msg}'}), 500


# ==================== TEAM MEMBERS ====================

@team_settings_bp.route('/<int:team_id>/members', methods=['GET'])
@jwt_required()
@require_team_role()  # Any member can view
def get_team_members(team_id):
    """Get team members"""
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        return jsonify({
            'members': [m.to_dict() for m in team.members]
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get team members: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get team members'}), 500


@team_settings_bp.route('/<int:team_id>/members/<int:user_id>', methods=['PUT'])
@jwt_required()
@require_team_role('owner', 'manager')  # Only owner/manager can edit members
def update_team_member(team_id, user_id):
    """Update team member role and permissions"""
    current_user_id = int(get_jwt_identity())
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        member = TeamMember.query.filter_by(team_id=team_id, user_id=user_id).first()
        if not member:
            return jsonify({'error': 'Team member not found'}), 404
        
        data = request.get_json()
        
        old_role = member.role
        
        # Update role if provided
        if 'role' in data:
            new_role = data['role']
            if new_role not in ['owner', 'manager', 'member', 'viewer']:
                return jsonify({'error': 'Invalid role'}), 400
            member.role = new_role
        
        # Update permissions if provided
        if 'can_schedule' in data:
            member.can_schedule = data['can_schedule']
        if 'can_draft' in data:
            member.can_draft = data['can_draft']
        if 'requires_approval' in data:
            member.requires_approval = data['requires_approval']
        
        db.session.commit()
        
        log_activity(
            current_user_id,
            'member_updated',
            f'Updated team member {member.user.email} role to {member.role}',
            resource_type='team_member',
            resource_id=user_id,
            team_id=team_id,
            metadata={'old_role': old_role, 'new_role': member.role}
        )
        
        return jsonify({
            'message': 'Team member updated',
            'member': member.to_dict()
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to update team member: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to update team member'}), 500


@team_settings_bp.route('/<int:team_id>/members/<int:user_id>', methods=['DELETE'])
@jwt_required()
@require_team_role('owner', 'manager')  # Only owner/manager can remove members
def remove_team_member(team_id, user_id):
    """Remove team member"""
    current_user_id = int(get_jwt_identity())
    
    # Prevent removing self as owner
    if current_user_id == user_id:
        current_role = get_user_team_role(current_user_id, team_id)
        if current_role == 'owner':
            return jsonify({'error': 'Cannot remove yourself as team owner'}), 400
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        member = TeamMember.query.filter_by(team_id=team_id, user_id=user_id).first()
        if not member:
            return jsonify({'error': 'Team member not found'}), 404
        
        member_email = member.user.email
        db.session.delete(member)
        db.session.commit()
        
        log_activity(
            current_user_id,
            'member_removed',
            f'Removed team member {member_email}',
            resource_type='team_member',
            resource_id=user_id,
            team_id=team_id
        )
        
        return jsonify({'message': f'Member {member_email} removed from team'}), 200
    
    except Exception as e:
        logger.error(f'Failed to remove team member: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to remove team member'}), 500


# ==================== INVITATIONS ====================

@team_settings_bp.route('/<int:team_id>/invitations', methods=['GET'])
@jwt_required()
@require_team_role('owner', 'manager')  # Only owner/manager can view invitations
def get_pending_invitations(team_id):
    """Get pending invitations for team"""
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        invitations = Invitation.query.filter_by(
            team_id=team_id,
            status='pending'
        ).all()
        
        return jsonify({
            'invitations': [
                {
                    'id': i.id,
                    'email': i.email,
                    'status': i.status,
                    'created_at': i.created_at.isoformat(),
                    'expires_at': i.expires_at.isoformat()
                } for i in invitations
            ]
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get invitations: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get invitations'}), 500


@team_settings_bp.route('/<int:team_id>/invitations/<int:invitation_id>/resend', methods=['POST'])
@jwt_required()
@require_team_role('owner', 'manager')
def resend_invitation(team_id, invitation_id):
    """Resend an invitation"""
    current_user_id = int(get_jwt_identity())
    
    try:
        invitation = Invitation.query.get(invitation_id)
        if not invitation or invitation.team_id != team_id:
            return jsonify({'error': 'Invitation not found'}), 404
        
        if invitation.status != 'pending':
            return jsonify({'error': 'Can only resend pending invitations'}), 400
        
        # Reset expiration time
        invitation.expires_at = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        from datetime import timedelta
        invitation.expires_at += timedelta(days=7)
        db.session.commit()
        
        # Send email invitation again
        try:
            from email_utils import EmailService, get_app_url
            team = Team.query.get(team_id)
            inviter = User.query.get(current_user_id)
            app_url = get_app_url()
            success, message = EmailService.send_invitation_email(
                invitation.email,
                invitation.token,
                inviter.name if inviter else 'PostWave',
                team.name,
                app_url
            )
            if not success:
                logger.warning(f'Failed to resend invitation email to {invitation.email}: {message}')
        except Exception as e:
            logger.error(f'Error resending invitation email: {str(e)}', exc_info=True)
        
        log_activity(
            current_user_id,
            'invitation_resent',
            f'Resent invitation to {invitation.email}',
            resource_type='invitation',
            resource_id=invitation_id,
            team_id=team_id
        )
        
        return jsonify({'message': 'Invitation resent'}), 200
    
    except Exception as e:
        logger.error(f'Failed to resend invitation: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to resend invitation'}), 500


@team_settings_bp.route('/<int:team_id>/invitations/<int:invitation_id>', methods=['DELETE'])
@jwt_required()
@require_team_role('owner', 'manager')
def cancel_invitation(team_id, invitation_id):
    """Cancel an invitation"""
    current_user_id = int(get_jwt_identity())
    
    try:
        invitation = Invitation.query.get(invitation_id)
        if not invitation or invitation.team_id != team_id:
            return jsonify({'error': 'Invitation not found'}), 404
        
        email = invitation.email
        db.session.delete(invitation)
        db.session.commit()
        
        log_activity(
            current_user_id,
            'invitation_cancelled',
            f'Cancelled invitation to {email}',
            resource_type='invitation',
            resource_id=invitation_id,
            team_id=team_id
        )
        
        return jsonify({'message': 'Invitation cancelled'}), 200
    
    except Exception as e:
        logger.error(f'Failed to cancel invitation: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to cancel invitation'}), 500


# ==================== TEAM ACTIVITY LOGS ====================

@team_settings_bp.route('/<int:team_id>/logs', methods=['GET'])
@jwt_required()
@require_team_role()  # Any team member can view logs
def get_team_logs(team_id):
    """Get team activity logs"""
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)
        action_type = request.args.get('action_type', '', type=str)
        search = request.args.get('search', '', type=str)
        
        query = ActivityLog.query.filter_by(team_id=team_id)
        
        if action_type:
            query = query.filter_by(action_type=action_type)
        
        if search:
            query = query.filter(ActivityLog.description.ilike(f'%{search}%'))
        
        logs = query.order_by(ActivityLog.created_at.desc()).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        return jsonify({
            'logs': [log.to_dict() for log in logs.items],
            'total': logs.total,
            'pages': logs.pages,
            'current_page': page
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get team logs: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get team logs'}), 500


# ==================== TEAM INSTAGRAM CONNECTION ====================

@team_settings_bp.route('/<int:team_id>/instagram/connect', methods=['POST'])
@jwt_required()
@require_team_role('owner', 'manager')  # Only owner/manager can connect Instagram
def connect_team_instagram(team_id):
    """Connect Instagram account to team"""
    current_user_id = int(get_jwt_identity())
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        data = request.get_json()
        
        if not data or not data.get('access_token'):
            return jsonify({'error': 'Missing access_token'}), 400
        
        # Import InstagramAPI with optional team-specific credentials
        from instagram_api import InstagramAPI
        
        # Use team-specific app credentials if available
        app_id = data.get('instagram_app_id') or team.instagram_app_id
        app_secret = data.get('instagram_app_secret') or team.instagram_app_secret
        
        ig_api = InstagramAPI(app_id=app_id, app_secret=app_secret)
        
        # Get long-lived token (will use token directly if app credentials not available)
        token_data = ig_api.get_long_lived_token(data['access_token'])
        
        # Get Instagram account info
        ig_account_id = None
        if data.get('instagram_account_id'):
            ig_account_id = data['instagram_account_id']
        elif data.get('page_id'):
            page_id = data['page_id']
            account_info = ig_api.get_page_instagram_account(page_id, token_data['access_token'])
            ig_account_id = account_info.get('instagram_business_account_id')
        else:
            # Try to auto-detect from token
            try:
                ig_account_id = ig_api.get_instagram_account_id_from_token(token_data['access_token'])
            except Exception as e:
                logger.warning(f'Auto-detection failed: {str(e)}')
        
        if not ig_account_id:
            return jsonify({'error': 'Could not find Instagram account. Please provide instagram_account_id or ensure your account is connected to a Facebook Page.'}), 400
        
        # Get account info
        account_info = ig_api.get_account_info(ig_account_id, token_data['access_token'])
        
        # Update team with Instagram credentials
        team.instagram_account_id = ig_account_id
        team.instagram_access_token = token_data['access_token']
        team.instagram_username = account_info.get('username')
        team.instagram_profile_picture = account_info.get('profile_picture_url')
        
        # Handle expires_at - it could be a datetime object or a timestamp
        expires_at = token_data.get('expires_at')
        if isinstance(expires_at, datetime):
            team.token_expires_at = expires_at
        elif isinstance(expires_at, (int, float)):
            team.token_expires_at = datetime.utcfromtimestamp(expires_at)
        else:
            team.token_expires_at = datetime.utcnow() + timedelta(days=60)  # Default 60 days
        
        db.session.commit()
        
        log_activity(
            current_user_id,
            'instagram_connected',
            f'Connected Instagram account @{team.instagram_username} to team',
            resource_type='team',
            resource_id=team_id,
            team_id=team_id,
            metadata={'instagram_username': team.instagram_username}
        )
        
        return jsonify({
            'message': 'Instagram connected successfully',
            'instagram_username': team.instagram_username,
            'instagram_connected': True
        }), 200
    
    except Exception as e:
        error_msg = str(e)
        logger.error(f'Failed to connect Instagram for team: {error_msg}', exc_info=True)
        print(f'[ERROR] Instagram connect failed: {error_msg}')  # Also print to console
        return jsonify({
            'error': f'Failed to connect Instagram: {error_msg}',
            'details': error_msg
        }), 500


# ==================== TEAM OWNERSHIP TRANSFER ====================

@team_settings_bp.route('/<int:team_id>/transfer-ownership', methods=['POST'])
@jwt_required()
@require_team_role('owner')  # Only owner can transfer ownership
def transfer_ownership(team_id):
    """Transfer team ownership to another member"""
    current_user_id = int(get_jwt_identity())
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        data = request.get_json()
        new_owner_id = data.get('new_owner_id')
        
        if not new_owner_id:
            return jsonify({'error': 'new_owner_id is required'}), 400
        
        # Verify new owner is a member of the team
        new_owner_member = TeamMember.query.filter_by(team_id=team_id, user_id=new_owner_id).first()
        if not new_owner_member:
            return jsonify({'error': 'User is not a member of this team'}), 404
        
        # Get current owner's membership
        current_owner = TeamMember.query.filter_by(team_id=team_id, user_id=current_user_id).first()
        if not current_owner:
            return jsonify({'error': 'Current user is not a member of this team'}), 404
        
        # Update roles
        current_owner.role = 'manager'
        new_owner_member.role = 'owner'
        
        db.session.commit()
        
        # Log activity
        new_owner_user = User.query.get(new_owner_id)
        log_activity(
            current_user_id,
            'ownership_transferred',
            f'Transferred team ownership to {new_owner_user.email}',
            resource_type='team',
            resource_id=team_id,
            team_id=team_id,
            metadata={'new_owner_id': new_owner_id, 'new_owner_email': new_owner_user.email}
        )
        
        return jsonify({
            'message': 'Team ownership transferred successfully',
            'new_owner_id': new_owner_id,
            'new_owner_email': new_owner_user.email
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to transfer ownership: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to transfer ownership'}), 500


# ==================== TEAM MEMBER INVITATION ====================

@team_settings_bp.route('/<int:team_id>/invite', methods=['POST'])
@jwt_required()
@require_team_role('owner', 'manager')  # Only owner/manager can invite
def invite_team_member(team_id):
    """Invite a user to the team by email"""
    current_user_id = int(get_jwt_identity())
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        data = request.get_json()
        email = data.get('email', '').lower().strip()
        
        if not email:
            return jsonify({'error': 'Email is required'}), 400
        
        # Check if user already in team
        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            existing_member = TeamMember.query.filter_by(
                team_id=team_id,
                user_id=existing_user.id
            ).first()
            if existing_member:
                return jsonify({'error': 'User is already a member of this team'}), 400
        
        # Check if invitation already pending
        pending_invite = Invitation.query.filter_by(
            team_id=team_id,
            email=email,
            status='pending'
        ).first()
        if pending_invite:
            return jsonify({'error': 'Invitation already pending for this email'}), 400
        
        # Create invitation
        from datetime import timedelta
        invitation_token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(days=7)
        
        invitation = Invitation(
            team_id=team_id,
            email=email,
            token=invitation_token,
            expires_at=expires_at,
            invited_by=current_user_id,
            status='pending'
        )
        
        db.session.add(invitation)
        db.session.commit()
        
        # Log activity
        inviter = User.query.get(current_user_id)
        log_activity(
            current_user_id,
            'member_invited',
            f'Invited {email} to team',
            resource_type='invitation',
            resource_id=invitation.id,
            team_id=team_id,
            metadata={'invited_email': email}
        )
        
        # Send email invitation
        try:
            from email_utils import EmailService, get_app_url
            app_url = get_app_url()
            success, message = EmailService.send_invitation_email(
                email,
                invitation_token,
                inviter.name if inviter else 'PostWave',
                team.name,
                app_url
            )
            if not success:
                logger.warning(f'Failed to send invitation email to {email}: {message}')
        except Exception as e:
            logger.error(f'Error sending invitation email: {str(e)}', exc_info=True)
        
        return jsonify({
            'message': f'Invitation sent to {email}',
            'invitation': {
                'id': invitation.id,
                'email': email,
                'created_at': invitation.created_at.isoformat(),
                'expires_at': invitation.expires_at.isoformat()
            }
        }), 201
    
    except Exception as e:
        logger.error(f'Failed to invite team member: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to send invitation'}), 500
