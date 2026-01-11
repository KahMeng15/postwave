from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Team, TeamMember, ActivityLog, Settings
from datetime import datetime
import logging
import bcrypt
import os

logger = logging.getLogger(__name__)
admin_settings_bp = Blueprint('admin_settings', __name__, url_prefix='/api/admin-settings')


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


def check_super_admin(user_id):
    """Check if user is super admin"""
    user = User.query.get(user_id)
    return user and user.is_super_admin


# ==================== USER MANAGEMENT ====================

@admin_settings_bp.route('/users', methods=['GET'])
@jwt_required()
def get_all_users():
    """Get all users in the system"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search = request.args.get('search', '', type=str)
        
        query = User.query
        
        # Search by name or email
        if search:
            query = query.filter(
                (User.name.ilike(f'%{search}%')) | 
                (User.email.ilike(f'%{search}%'))
            )
        
        users = query.paginate(page=page, per_page=per_page, error_out=False)
        
        return jsonify({
            'users': [
                {
                    'id': u.id,
                    'name': u.name,
                    'email': u.email,
                    'is_super_admin': u.is_super_admin,
                    'is_active': u.is_active,
                    'created_at': u.created_at.isoformat(),
                    'teams_count': len(u.team_memberships)
                } for u in users.items
            ],
            'total': users.total,
            'pages': users.pages,
            'current_page': page
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get users: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get users'}), 500


@admin_settings_bp.route('/users/<int:user_id>/promote', methods=['POST'])
@jwt_required()
def promote_to_admin(user_id):
    """Promote user to super admin"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        if user.is_super_admin:
            return jsonify({'error': 'User is already an admin'}), 400
        
        user.is_super_admin = True
        db.session.commit()
        
        log_activity(
            current_user_id,
            'user_promoted',
            f'Promoted {user.email} to super admin',
            resource_type='user',
            resource_id=user_id
        )
        
        return jsonify({
            'message': f'User {user.email} promoted to super admin',
            'user': {
                'id': user.id,
                'name': user.name,
                'email': user.email,
                'is_super_admin': user.is_super_admin
            }
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to promote user: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to promote user'}), 500


@admin_settings_bp.route('/users/<int:user_id>/demote', methods=['POST'])
@jwt_required()
def demote_from_admin(user_id):
    """Demote super admin to regular user"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    # Prevent self-demotion
    if current_user_id == user_id:
        return jsonify({'error': 'Cannot demote yourself'}), 400
    
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        if not user.is_super_admin:
            return jsonify({'error': 'User is not an admin'}), 400
        
        user.is_super_admin = False
        db.session.commit()
        
        log_activity(
            current_user_id,
            'user_demoted',
            f'Demoted {user.email} from super admin',
            resource_type='user',
            resource_id=user_id
        )
        
        return jsonify({
            'message': f'User {user.email} demoted from super admin',
            'user': {
                'id': user.id,
                'name': user.name,
                'email': user.email,
                'is_super_admin': user.is_super_admin
            }
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to demote user: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to demote user'}), 500


@admin_settings_bp.route('/users/<int:user_id>/deactivate', methods=['POST'])
@jwt_required()
def deactivate_user(user_id):
    """Deactivate a user account"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    if current_user_id == user_id:
        return jsonify({'error': 'Cannot deactivate yourself'}), 400
    
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        if not user.is_active:
            return jsonify({'error': 'User is already deactivated'}), 400
        
        user.is_active = False
        db.session.commit()
        
        log_activity(
            current_user_id,
            'user_deactivated',
            f'Deactivated user {user.email}',
            resource_type='user',
            resource_id=user_id
        )
        
        return jsonify({
            'message': f'User {user.email} deactivated',
            'user': {
                'id': user.id,
                'name': user.name,
                'email': user.email,
                'is_active': user.is_active
            }
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to deactivate user: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to deactivate user'}), 500


@admin_settings_bp.route('/users/<int:user_id>/delete', methods=['DELETE'])
@jwt_required()
def delete_user(user_id):
    """Delete a user account and all associated data"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    if current_user_id == user_id:
        return jsonify({'error': 'Cannot delete yourself'}), 400
    
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        user_email = user.email
        db.session.delete(user)
        db.session.commit()
        
        log_activity(
            current_user_id,
            'user_deleted',
            f'Deleted user {user_email}',
            resource_type='user',
            resource_id=user_id
        )
        
        return jsonify({'message': f'User {user_email} deleted successfully'}), 200
    
    except Exception as e:
        logger.error(f'Failed to delete user: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to delete user'}), 500


# ==================== TEAM MANAGEMENT ====================

@admin_settings_bp.route('/teams', methods=['GET'])
@jwt_required()
def get_all_teams():
    """Get all teams in the system"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search = request.args.get('search', '', type=str)
        
        query = Team.query
        
        if search:
            query = query.filter(Team.name.ilike(f'%{search}%'))
        
        teams = query.paginate(page=page, per_page=per_page, error_out=False)
        
        return jsonify({
            'teams': [
                {
                    'id': t.id,
                    'name': t.name,
                    'description': t.description,
                    'created_by': t.created_by,
                    'created_at': t.created_at.isoformat(),
                    'instagram_username': t.instagram_username,
                    'instagram_connected': bool(t.instagram_account_id),
                    'members_count': len(t.members)
                } for t in teams.items
            ],
            'total': teams.total,
            'pages': teams.pages,
            'current_page': page
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get teams: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get teams'}), 500


@admin_settings_bp.route('/teams', methods=['POST'])
@jwt_required()
def create_team_admin():
    """Admin create a new team"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        data = request.get_json()
        
        if not data.get('name'):
            return jsonify({'error': 'Team name is required'}), 400
        
        owner_id = data.get('owner_id')
        if not owner_id:
            return jsonify({'error': 'Owner ID is required'}), 400
        
        owner = User.query.get(owner_id)
        if not owner:
            return jsonify({'error': 'Owner user not found'}), 404
        
        # Create team
        team = Team(
            name=data['name'],
            description=data.get('description', ''),
            created_by=owner_id
        )
        db.session.add(team)
        db.session.flush()  # Get the team ID
        
        # Add owner as team member
        team_member = TeamMember(
            team_id=team.id,
            user_id=owner_id,
            role='owner'
        )
        db.session.add(team_member)
        db.session.commit()
        
        log_activity(
            current_user_id,
            'team_created',
            f'Created team {team.name}',
            resource_type='team',
            resource_id=team.id
        )
        
        return jsonify({
            'message': 'Team created successfully',
            'team': team.to_dict(include_members=True)
        }), 201
    
    except Exception as e:
        logger.error(f'Failed to create team: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to create team'}), 500


@admin_settings_bp.route('/teams/<int:team_id>', methods=['PUT'])
@jwt_required()
def update_team_admin(team_id):
    """Admin update team details"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        data = request.get_json()
        
        old_data = {
            'name': team.name,
            'description': team.description
        }
        
        if 'name' in data:
            team.name = data['name']
        if 'description' in data:
            team.description = data['description']
        
        # Handle owner change
        if 'owner_id' in data and data['owner_id'] != team.created_by:
            new_owner_id = data['owner_id']
            new_owner = User.query.get(new_owner_id)
            if not new_owner:
                return jsonify({'error': 'New owner not found'}), 404
            
            # Remove old owner role
            old_owner_member = TeamMember.query.filter_by(
                team_id=team_id,
                user_id=team.created_by,
                role='owner'
            ).first()
            if old_owner_member:
                old_owner_member.role = 'manager'
            
            # Set new owner
            team.created_by = new_owner_id
            new_owner_member = TeamMember.query.filter_by(
                team_id=team_id,
                user_id=new_owner_id
            ).first()
            if new_owner_member:
                new_owner_member.role = 'owner'
            else:
                new_member = TeamMember(
                    team_id=team_id,
                    user_id=new_owner_id,
                    role='owner'
                )
                db.session.add(new_member)
        
        db.session.commit()
        
        log_activity(
            current_user_id,
            'team_updated',
            f'Updated team {team.name}',
            resource_type='team',
            resource_id=team_id,
            metadata={'old_data': old_data, 'new_data': {k: v for k, v in data.items() if k in old_data}}
        )
        
        return jsonify({
            'message': 'Team updated successfully',
            'team': team.to_dict(include_members=True)
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to update team: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to update team'}), 500


@admin_settings_bp.route('/teams/<int:team_id>', methods=['DELETE'])
@jwt_required()
def delete_team_admin(team_id):
    """Admin delete a team"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        team = Team.query.get(team_id)
        if not team:
            return jsonify({'error': 'Team not found'}), 404
        
        team_name = team.name
        db.session.delete(team)
        db.session.commit()
        
        log_activity(
            current_user_id,
            'team_deleted',
            f'Deleted team {team_name}',
            resource_type='team',
            resource_id=team_id
        )
        
        return jsonify({'message': f'Team {team_name} deleted successfully'}), 200
    
    except Exception as e:
        logger.error(f'Failed to delete team: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to delete team'}), 500


# ==================== SETTINGS MANAGEMENT ====================

@admin_settings_bp.route('/domain', methods=['GET'])
@jwt_required()
def get_domain_setting():
    """Get application domain setting"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        domain_setting = Settings.query.filter_by(key='app_domain').first()
        
        return jsonify({
            'domain': domain_setting.value if domain_setting else None
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get domain setting: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get domain setting'}), 500


@admin_settings_bp.route('/domain', methods=['POST'])
@jwt_required()
def set_domain_setting():
    """Set application domain"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        data = request.get_json()
        domain = data.get('domain', '').strip()
        
        if not domain:
            return jsonify({'error': 'Domain is required'}), 400
        
        domain_setting = Settings.query.filter_by(key='app_domain').first()
        if not domain_setting:
            domain_setting = Settings(
                key='app_domain',
                value=domain,
                setting_type='string',
                description='Application domain for email links and redirects'
            )
            db.session.add(domain_setting)
        else:
            domain_setting.value = domain
        
        db.session.commit()
        
        log_activity(
            current_user_id,
            'config_changed',
            f'Updated application domain to {domain}',
            resource_type='settings',
            resource_id=None
        )
        
        return jsonify({
            'message': 'Domain setting updated',
            'domain': domain
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to set domain: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to set domain'}), 500


# ==================== EMAIL/SMTP SETTINGS ====================

@admin_settings_bp.route('/email', methods=['GET'])
@jwt_required()
def get_email_settings():
    """Get SMTP email settings"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        settings = {}
        
        # Define email settings keys (both uppercase from onboarding and lowercase for consistency)
        email_keys = [
            'MAIL_SERVER', 'MAIL_PORT', 'MAIL_USE_TLS', 'MAIL_USERNAME', 
            'MAIL_PASSWORD', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME',
            'mail_server', 'mail_port', 'mail_use_tls', 'mail_username',
            'mail_password', 'mail_from_email', 'mail_from_name'
        ]
        
        # Get from database
        for key in email_keys:
            setting = Settings.query.filter_by(key=key).first()
            if setting:
                value = setting.value
                # Convert port to integer
                if 'port' in key.lower():
                    value = int(value) if value else 587
                # Convert boolean string
                elif 'tls' in key.lower():
                    value = value.lower() == 'true' if isinstance(value, str) else value
                # Store with lowercase key for consistency
                normalized_key = key.lower()
                settings[normalized_key] = value
        
        # Return with lowercase keys
        return jsonify({
            'mail_server': settings.get('mail_server', ''),
            'mail_port': settings.get('mail_port', 587),
            'mail_use_tls': settings.get('mail_use_tls', True),
            'mail_username': settings.get('mail_username', ''),
            'mail_password': settings.get('mail_password', ''),
            'mail_from_email': settings.get('mail_from_email', 'noreply@postwave.com'),
            'mail_from_name': settings.get('mail_from_name', 'PostWave')
        }), 200
        
        return jsonify(settings), 200
    
    except Exception as e:
        logger.error(f'Failed to get email settings: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get email settings'}), 500


@admin_settings_bp.route('/email', methods=['POST'])
@jwt_required()
def set_email_settings():
    """Update SMTP email settings"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    try:
        data = request.get_json()
        
        # Define editable email settings (use lowercase keys)
        email_settings = {
            'mail_server': data.get('mail_server', ''),
            'mail_port': str(data.get('mail_port', 587)),
            'mail_use_tls': str(data.get('mail_use_tls', True)).lower(),
            'mail_username': data.get('mail_username', ''),
            'mail_password': data.get('mail_password', ''),
            'mail_from_email': data.get('mail_from_email', 'noreply@postwave.com'),
            'mail_from_name': data.get('mail_from_name', 'PostWave')
        }
        
        # Update settings in database
        for key, value in email_settings.items():
            setting = Settings.query.filter_by(key=key).first()
            if setting:
                setting.value = value
            else:
                setting = Settings(key=key, value=value, setting_type='string' if key != 'mail_port' else 'integer')
                db.session.add(setting)
        
        db.session.commit()
        
        log_activity(
            current_user_id,
            'email_settings_updated',
            f'Updated email/SMTP settings',
            resource_type='settings',
            resource_id=None,
            metadata={'updated_keys': list(email_settings.keys())}
        )
        
        return jsonify({
            'message': 'Email settings updated successfully',
            'settings': email_settings
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to set email settings: {str(e)}', exc_info=True)
        return jsonify({'error': f'Failed to set email settings: {str(e)}'}), 500


@admin_settings_bp.route('/email/test', methods=['POST'])
@jwt_required()
def test_email():
    """Send a test email to verify SMTP configuration"""
    current_user_id = int(get_jwt_identity())
    
    if not check_super_admin(current_user_id):
        return jsonify({'error': 'Unauthorized - Admin only'}), 403
    
    user = User.query.get(current_user_id)
    
    try:
        data = request.get_json()
        test_email_address = data.get('email', user.email)
        
        # Get current email settings (check both lowercase and uppercase keys)
        mail_server = Settings.query.filter_by(key='mail_server').first() or Settings.query.filter_by(key='MAIL_SERVER').first()
        mail_port = Settings.query.filter_by(key='mail_port').first() or Settings.query.filter_by(key='MAIL_PORT').first()
        mail_use_tls = Settings.query.filter_by(key='mail_use_tls').first() or Settings.query.filter_by(key='MAIL_USE_TLS').first()
        mail_username = Settings.query.filter_by(key='mail_username').first() or Settings.query.filter_by(key='MAIL_USERNAME').first()
        mail_password = Settings.query.filter_by(key='mail_password').first() or Settings.query.filter_by(key='MAIL_PASSWORD').first()
        mail_from_email = Settings.query.filter_by(key='mail_from_email').first() or Settings.query.filter_by(key='MAIL_FROM_EMAIL').first()
        mail_from_name = Settings.query.filter_by(key='mail_from_name').first() or Settings.query.filter_by(key='MAIL_FROM_NAME').first()
        
        # Construct email configuration
        email_config = {
            'server': mail_server.value if mail_server else current_app.config.get('MAIL_SERVER'),
            'port': int(mail_port.value) if mail_port else current_app.config.get('MAIL_PORT', 587),
            'use_tls': (mail_use_tls.value.lower() == 'true') if mail_use_tls else current_app.config.get('MAIL_USE_TLS', True),
            'username': mail_username.value if mail_username else current_app.config.get('MAIL_USERNAME'),
            'password': mail_password.value if mail_password else os.getenv('MAIL_PASSWORD', ''),
            'from_email': mail_from_email.value if mail_from_email else current_app.config.get('MAIL_FROM_EMAIL'),
            'from_name': mail_from_name.value if mail_from_name else current_app.config.get('MAIL_FROM_NAME', 'PostWave')
        }
        
        # Validate settings
        if not email_config['server']:
            return jsonify({'error': 'Mail server not configured'}), 400
        if not email_config['username']:
            return jsonify({'error': 'Mail username not configured'}), 400
        if not email_config['password']:
            return jsonify({'error': 'Mail password not configured (set MAIL_PASSWORD env var)'}), 400
        
        # Send test email
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        try:
            # Create message
            msg = MIMEMultipart()
            msg['From'] = f"{email_config['from_name']} <{email_config['from_email']}>"
            msg['To'] = test_email_address
            msg['Subject'] = 'PostWave Email Configuration Test'
            
            body = """
<html>
  <body>
    <h2>PostWave Email Test</h2>
    <p>If you're reading this, your email configuration is working correctly!</p>
    <p><strong>Test Details:</strong></p>
    <ul>
      <li>Mail Server: {server}:{port}</li>
      <li>TLS Enabled: {use_tls}</li>
      <li>From Email: {from_email}</li>
      <li>Test Time: {timestamp}</li>
    </ul>
    <p>You can now use PostWave to send emails for team invitations and notifications.</p>
  </body>
</html>
            """.format(
                server=email_config['server'],
                port=email_config['port'],
                use_tls=email_config['use_tls'],
                from_email=email_config['from_email'],
                timestamp=datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
            )
            
            msg.attach(MIMEText(body, 'html'))
            
            # Connect and send
            if email_config['use_tls']:
                server = smtplib.SMTP(email_config['server'], email_config['port'], timeout=10)
                server.starttls()
            else:
                server = smtplib.SMTP(email_config['server'], email_config['port'], timeout=10)
            
            server.login(email_config['username'], email_config['password'])
            server.send_message(msg)
            server.quit()
            
            # Log successful test
            log_activity(
                current_user_id,
                'email_test_sent',
                f'Test email sent to {test_email_address}',
                resource_type='settings',
                metadata={'recipient': test_email_address}
            )
            
            return jsonify({
                'message': f'Test email sent successfully to {test_email_address}',
                'recipient': test_email_address
            }), 200
        
        except smtplib.SMTPAuthenticationError:
            return jsonify({'error': 'SMTP authentication failed - check username and password'}), 400
        except smtplib.SMTPException as e:
            return jsonify({'error': f'SMTP error: {str(e)}'}), 400
        except Exception as e:
            return jsonify({'error': f'Failed to send test email: {str(e)}'}), 400
    
    except Exception as e:
        logger.error(f'Failed to test email: {str(e)}', exc_info=True)
        return jsonify({'error': f'Failed to test email: {str(e)}'}), 500

