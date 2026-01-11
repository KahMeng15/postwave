"""Team management and invitations routes."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Team, TeamMember, Invitation, Post, PostApproval, Settings
from email_utils import EmailService
from datetime import datetime, timedelta
import secrets
import logging

logger = logging.getLogger(__name__)
teams_bp = Blueprint('teams', __name__)


@teams_bp.route('/setup-status', methods=['GET'])
def get_setup_status():
    """
    Check if setup is needed (no super admin exists).
    Returns 200 if setup is needed, 400 if already set up.
    """
    super_admin = User.query.filter_by(is_super_admin=True).first()
    
    if super_admin:
        return jsonify({'setup_complete': True, 'error': 'Super admin already exists. Setup is complete.'}), 400
    else:
        return jsonify({'setup_complete': False, 'message': 'Setup required'}), 200


@teams_bp.route('/setup-admin', methods=['POST'])
def setup_admin():
    """
    Initial setup endpoint to create the first super admin.
    Only works if no super admin exists yet.
    """
    # Check if super admin already exists
    if User.query.filter_by(is_super_admin=True).first():
        return jsonify({'error': 'Super admin already exists. Setup is complete.'}), 400
    
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('name') or not data.get('password'):
        return jsonify({'error': 'Missing required fields (email, name, password)'}), 400
    
    # Create super admin user
    try:
        user = User(
            email=data['email'],
            name=data['name'],
            is_super_admin=True,
            is_active=True
        )
        user.set_password(data['password'])
        
        db.session.add(user)
        db.session.commit()
        
        # Generate JWT tokens for immediate authentication
        from flask_jwt_extended import create_access_token, create_refresh_token
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        
        logger.info(f'Super admin created: {user.email}')
        
        return jsonify({
            'message': 'Super admin created successfully',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token
        }), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to create super admin: {str(e)}', exc_info=True)
        return jsonify({'error': f'Failed to create super admin: {str(e)}'}), 500


@teams_bp.route('/teams', methods=['GET'])
@jwt_required()
def get_teams():
    """Get all teams for current user or all teams if super admin."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    try:
        if user.is_super_admin:
            # Super admin sees all teams
            teams = Team.query.all()
        else:
            # Regular user sees only their teams
            teams = [tm.team for tm in user.team_memberships]
        
        return jsonify({
            'teams': [t.to_dict(include_members=True) for t in teams]
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get teams: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get teams'}), 500


@teams_bp.route('/teams', methods=['POST'])
@jwt_required()
def create_team():
    """Create a new team. Only super admin or team leaders can create teams."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    if not user.is_super_admin:
        # Check if user is a team leader
        is_leader = any(tm.role == 'leader' for tm in user.team_memberships)
        if not is_leader:
            return jsonify({'error': 'Only super admin or team leaders can create teams'}), 403
    
    data = request.get_json()
    
    if not data or not data.get('name'):
        return jsonify({'error': 'Team name is required'}), 400
    
    try:
        team = Team(
            name=data['name'],
            description=data.get('description'),
            created_by=current_user_id
        )
        
        db.session.add(team)
        db.session.flush()  # Get team ID
        
        # Add creator as team owner
        team_member = TeamMember(
            team_id=team.id,
            user_id=current_user_id,
            role='owner'
        )
        db.session.add(team_member)
        db.session.commit()
        
        logger.info(f'Team created: {team.name} by user {current_user_id}')
        
        return jsonify({
            'message': 'Team created successfully',
            'team': team.to_dict(include_members=True)
        }), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to create team: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to create team'}), 500


@teams_bp.route('/teams/<int:team_id>', methods=['GET'])
@jwt_required()
def get_team(team_id):
    """Get team details. Only members or super admin can view."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found'}), 404
    
    # Check access
    is_member = any(tm.team_id == team_id for tm in user.team_memberships)
    if not is_member and not user.is_super_admin:
        return jsonify({'error': 'Access denied'}), 403
    
    return jsonify(team.to_dict(include_members=True)), 200


@teams_bp.route('/teams/<int:team_id>', methods=['PUT'])
@jwt_required()
def update_team(team_id):
    """Update team. Only team leader or super admin can update."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found'}), 404
    
    # Check access
    team_member = TeamMember.query.filter_by(team_id=team_id, user_id=current_user_id).first()
    is_leader = team_member and team_member.role == 'leader'
    
    if not is_leader and not user.is_super_admin:
        return jsonify({'error': 'Only team leaders or super admin can update team'}), 403
    
    data = request.get_json()
    
    try:
        if 'name' in data:
            team.name = data['name']
        if 'description' in data:
            team.description = data['description']
        if 'instagram_username' in data:
            team.instagram_username = data['instagram_username']
        
        db.session.commit()
        logger.info(f'Team {team_id} updated by user {current_user_id}')
        
        return jsonify({
            'message': 'Team updated successfully',
            'team': team.to_dict()
        }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to update team: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to update team'}), 500


@teams_bp.route('/teams/<int:team_id>/members', methods=['GET'])
@jwt_required()
def get_team_members(team_id):
    """Get team members. Only team members or super admin can view."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Check access
    is_member = any(tm.team_id == team_id for tm in user.team_memberships)
    if not is_member and not user.is_super_admin:
        return jsonify({'error': 'Access denied'}), 403
    
    members = TeamMember.query.filter_by(team_id=team_id).all()
    
    return jsonify({
        'members': [m.to_dict() for m in members]
    }), 200


@teams_bp.route('/teams/<int:team_id>/members/<int:user_id>', methods=['PUT'])
@jwt_required()
def update_team_member(team_id, user_id):
    """Update team member role/permissions. Only team leader or super admin."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Check access
    team_member = TeamMember.query.filter_by(team_id=team_id, user_id=current_user_id).first()
    is_leader = team_member and team_member.role == 'leader'
    
    if not is_leader and not user.is_super_admin:
        return jsonify({'error': 'Access denied'}), 403
    
    member = TeamMember.query.filter_by(team_id=team_id, user_id=user_id).first()
    if not member:
        return jsonify({'error': 'Team member not found'}), 404
    
    data = request.get_json()
    
    try:
        if 'role' in data:
            member.role = data['role']
        if 'can_schedule' in data:
            member.can_schedule = data['can_schedule']
        if 'can_draft' in data:
            member.can_draft = data['can_draft']
        if 'requires_approval' in data:
            member.requires_approval = data['requires_approval']
        
        db.session.commit()
        logger.info(f'Team member {user_id} updated in team {team_id}')
        
        return jsonify({
            'message': 'Team member updated',
            'member': member.to_dict()
        }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to update team member: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to update team member'}), 500


@teams_bp.route('/teams/<int:team_id>/members/<int:user_id>', methods=['DELETE'])
@jwt_required()
def remove_team_member(team_id, user_id):
    """Remove member from team. Only team leader or super admin."""
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Check access
    team_member = TeamMember.query.filter_by(team_id=team_id, user_id=current_user_id).first()
    is_leader = team_member and team_member.role == 'leader'
    
    if not is_leader and not user.is_super_admin:
        return jsonify({'error': 'Access denied'}), 403
    
    member = TeamMember.query.filter_by(team_id=team_id, user_id=user_id).first()
    if not member:
        return jsonify({'error': 'Team member not found'}), 404
    
    try:
        db.session.delete(member)
        db.session.commit()
        logger.info(f'User {user_id} removed from team {team_id}')
        
        return jsonify({'message': 'Member removed from team'}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to remove team member: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to remove member'}), 500


@teams_bp.route('/invite', methods=['POST'])
@jwt_required()
def invite_user():
    """
    Invite a user to a team.
    If user doesn't exist, send registration invite.
    If user exists, add directly to team.
    """
    current_user_id = int(get_jwt_identity())
    inviter = User.query.get(current_user_id)
    
    if not inviter:
        return jsonify({'error': 'User not found'}), 404
    
    data = request.get_json()
    email = data.get('email')
    team_id = data.get('team_id')
    role = data.get('role', 'member')
    requires_approval = data.get('requires_approval', False)
    
    if not email or not team_id:
        return jsonify({'error': 'Email and team_id are required'}), 400
    
    team = Team.query.get(team_id)
    if not team:
        return jsonify({'error': 'Team not found'}), 404
    
    # Check if inviter is team leader or super admin
    team_member = TeamMember.query.filter_by(team_id=team_id, user_id=current_user_id).first()
    is_leader = team_member and team_member.role == 'leader'
    
    if not is_leader and not inviter.is_super_admin:
        return jsonify({'error': 'Access denied'}), 403
    
    try:
        # Check if user already exists
        existing_user = User.query.filter_by(email=email).first()
        
        if existing_user:
            # User exists, add directly to team if not already a member
            existing_member = TeamMember.query.filter_by(
                team_id=team_id,
                user_id=existing_user.id
            ).first()
            
            if existing_member:
                return jsonify({'error': 'User is already a member of this team'}), 400
            
            # Add user to team
            new_member = TeamMember(
                team_id=team_id,
                user_id=existing_user.id,
                role=role,
                requires_approval=requires_approval
            )
            db.session.add(new_member)
            db.session.commit()
            
            # Send notification email
            EmailService.send_registration_notification(
                existing_user.email,
                existing_user.name,
                inviter.name,
                team.name
            )
            
            logger.info(f'User {existing_user.id} added to team {team_id}')
            
            return jsonify({
                'message': f'{email} added to team',
                'existing_user': True
            }), 200
        
        else:
            # User doesn't exist, create invitation
            token = secrets.token_urlsafe(32)
            expires_at = datetime.utcnow() + timedelta(days=7)
            
            invitation = Invitation(
                email=email,
                team_id=team_id,
                invited_by=current_user_id,
                role=role,
                requires_approval=requires_approval,
                token=token,
                expires_at=expires_at
            )
            db.session.add(invitation)
            db.session.commit()
            
            # Get app URL from settings, default to localhost if not set
            app_url_setting = Settings.query.filter_by(key='app_domain').first()
            app_url = app_url_setting.value if app_url_setting else 'http://localhost:5500'
            
            # Send invitation email
            success, message = EmailService.send_invitation_email(
                email,
                token,
                inviter.name,
                team.name,
                base_url=app_url
            )
            
            if success:
                logger.info(f'Invitation sent to {email} for team {team_id}')
                return jsonify({
                    'message': f'Invitation sent to {email}',
                    'existing_user': False
                }), 200
            else:
                logger.warning(f'Failed to send invitation email to {email}: {message}')
                return jsonify({
                    'message': 'Invitation created but email failed to send',
                    'email_error': message,
                    'existing_user': False
                }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to invite user: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to send invitation'}), 500


@teams_bp.route('/accept-invite/<token>', methods=['GET'])
def get_invitation_details(token):
    """Get invitation details for registration."""
    invitation = Invitation.query.filter_by(token=token).first()
    
    if not invitation:
        return jsonify({'error': 'Invalid invitation token'}), 404
    
    if invitation.status != 'pending':
        return jsonify({'error': 'Invitation already accepted or declined'}), 400
    
    if datetime.utcnow() > invitation.expires_at:
        return jsonify({'error': 'Invitation has expired'}), 400
    
    team = Team.query.get(invitation.team_id)
    
    # Check if user already exists
    existing_user = User.query.filter_by(email=invitation.email).first()
    
    return jsonify({
        'email': invitation.email,
        'user_exists': existing_user is not None,
        'team': {
            'id': team.id,
            'name': team.name
        } if team else None,
        'expires_at': invitation.expires_at.isoformat()
    }), 200


@teams_bp.route('/accept-invite/<token>', methods=['POST'])
def accept_invitation(token):
    """Accept an invitation and register/join team."""
    data = request.get_json()
    
    if not data or not data.get('password'):
        return jsonify({'error': 'Password is required'}), 400
    
    invitation = Invitation.query.filter_by(token=token).first()
    
    if not invitation:
        return jsonify({'error': 'Invalid invitation token'}), 404
    
    if invitation.status != 'pending':
        return jsonify({'error': 'Invitation already accepted or declined'}), 400
    
    if datetime.utcnow() > invitation.expires_at:
        return jsonify({'error': 'Invitation has expired'}), 400
    
    try:
        # Check if user already exists
        existing_user = User.query.filter_by(email=invitation.email).first()
        
        if existing_user:
            # User exists, just add to team
            user = existing_user
        else:
            # Create new user
            # Use email as identifier, extract name from email if not provided
            name = data.get('name') or invitation.email.split('@')[0]
            
            user = User(
                email=invitation.email,
                name=name,
                is_active=True
            )
            user.set_password(data['password'])
            db.session.add(user)
            db.session.flush()
        
        # Add to team
        existing_member = TeamMember.query.filter_by(
            team_id=invitation.team_id,
            user_id=user.id
        ).first()
        
        if not existing_member:
            team_member = TeamMember(
                team_id=invitation.team_id,
                user_id=user.id,
                role=invitation.role,
                requires_approval=invitation.requires_approval
            )
            db.session.add(team_member)
        
        # Mark invitation as accepted
        invitation.status = 'accepted'
        
        db.session.commit()
        
        # Generate JWT tokens for auto-login
        from flask_jwt_extended import create_access_token, create_refresh_token
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        
        logger.info(f'Invitation accepted by {user.email}')
        
        return jsonify({
            'message': 'Invitation accepted successfully',
            'access_token': access_token,
            'refresh_token': refresh_token,
            'user': user.to_dict()
        }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f'Failed to accept invitation: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to accept invitation'}), 500
