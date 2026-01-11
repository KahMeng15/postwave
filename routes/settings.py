from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Settings
import os
from datetime import datetime

settings_bp = Blueprint('settings', __name__, url_prefix='/api/settings')

# Settings configuration with descriptions and types
EDITABLE_SETTINGS = {
    'MAIL_SERVER': {'type': 'string', 'description': 'SMTP server address (e.g., smtp.gmail.com)', 'editable': True},
    'MAIL_PORT': {'type': 'integer', 'description': 'SMTP port number (e.g., 587)', 'editable': True},
    'MAIL_USE_TLS': {'type': 'boolean', 'description': 'Use TLS for email (true/false)', 'editable': True},
    'MAIL_USERNAME': {'type': 'string', 'description': 'Email address for sending invitations', 'editable': True},
    'MAIL_PASSWORD': {'type': 'string', 'description': 'Email password or app password', 'editable': True},
    'MAIL_FROM_EMAIL': {'type': 'string', 'description': 'From email address in emails', 'editable': True},
    'MAIL_FROM_NAME': {'type': 'string', 'description': 'From name in emails', 'editable': True},
    'APP_HOST': {'type': 'string', 'description': 'Public URL for media access', 'editable': True},
}


@settings_bp.route('/', methods=['GET'])
@jwt_required()
def get_settings():
    """Get all editable settings. Super admin only."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user or not user.is_super_admin:
        return jsonify({'error': 'Only super admins can access settings'}), 403
    
    settings = Settings.query.filter_by(editable=True).all()
    
    # Include environment variable values as fallback
    result = {}
    for key in EDITABLE_SETTINGS.keys():
        setting = Settings.query.filter_by(key=key).first()
        
        # Use database value if set, otherwise use environment variable
        value = setting.value if setting else os.getenv(key, '')
        
        result[key] = {
            'value': value,
            'type': EDITABLE_SETTINGS[key]['type'],
            'description': EDITABLE_SETTINGS[key]['description'],
            'source': 'database' if setting else 'environment'
        }
    
    return jsonify(result), 200


@settings_bp.route('/', methods=['PUT'])
@jwt_required()
def update_settings():
    """Update settings. Super admin only."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user or not user.is_super_admin:
        return jsonify({'error': 'Only super admins can update settings'}), 403
    
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    updated = []
    errors = []
    
    for key, value in data.items():
        # Validate key
        if key not in EDITABLE_SETTINGS:
            errors.append(f'Unknown setting: {key}')
            continue
        
        # Validate and convert value based on type
        setting_type = EDITABLE_SETTINGS[key]['type']
        
        try:
            if setting_type == 'boolean':
                if isinstance(value, bool):
                    converted_value = str(value)
                else:
                    converted_value = str(value).lower() in ('true', 'yes', '1')
                    converted_value = str(converted_value)
            elif setting_type == 'integer':
                converted_value = str(int(value))
            else:  # string
                converted_value = str(value)
        except (ValueError, TypeError) as e:
            errors.append(f'Invalid value for {key}: {str(e)}')
            continue
        
        # Update or create setting
        setting = Settings.query.filter_by(key=key).first()
        
        if not setting:
            setting = Settings(
                key=key,
                value=converted_value,
                setting_type=setting_type,
                description=EDITABLE_SETTINGS[key]['description'],
                editable=True
            )
            db.session.add(setting)
        else:
            setting.value = converted_value
            setting.updated_at = datetime.utcnow()
        
        updated.append(key)
    
    if updated:
        db.session.commit()
    
    return jsonify({
        'success': True,
        'updated': updated,
        'errors': errors if errors else None,
        'message': f'Updated {len(updated)} setting(s)'
    }), 200


@settings_bp.route('/initialize', methods=['POST'])
@jwt_required()
def initialize_settings():
    """Initialize settings from environment variables. Super admin only."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user or not user.is_super_admin:
        return jsonify({'error': 'Only super admins can initialize settings'}), 403
    
    initialized = []
    
    for key, config in EDITABLE_SETTINGS.items():
        # Check if setting already exists
        setting = Settings.query.filter_by(key=key).first()
        
        if not setting:
            env_value = os.getenv(key, '')
            setting = Settings(
                key=key,
                value=env_value,
                setting_type=config['type'],
                description=config['description'],
                editable=config['editable']
            )
            db.session.add(setting)
            initialized.append(key)
    
    db.session.commit()
    
    return jsonify({
        'success': True,
        'initialized': initialized,
        'message': f'Initialized {len(initialized)} setting(s) from environment'
    }), 200


@settings_bp.route('/<key>', methods=['GET'])
@jwt_required()
def get_setting(key):
    """Get a specific setting. Super admin only."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user or not user.is_super_admin:
        return jsonify({'error': 'Only super admins can access settings'}), 403
    
    if key not in EDITABLE_SETTINGS:
        return jsonify({'error': 'Unknown setting'}), 404
    
    setting = Settings.query.filter_by(key=key).first()
    value = setting.value if setting else os.getenv(key, '')
    
    return jsonify({
        'key': key,
        'value': value,
        'type': EDITABLE_SETTINGS[key]['type'],
        'description': EDITABLE_SETTINGS[key]['description'],
        'source': 'database' if setting else 'environment'
    }), 200


@settings_bp.route('/email', methods=['GET'])
@jwt_required()
def get_email_settings():
    """Get email (SMTP) settings. Super admin only."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user or not user.is_super_admin:
        return jsonify({'error': 'Only super admins can view settings'}), 403
    
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
    
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.error(f'Failed to get email settings: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get email settings'}), 500


@settings_bp.route('/email', methods=['POST'])
@jwt_required()
def update_email_settings():
    """Update email (SMTP) settings. Super admin only. Used during onboarding."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user or not user.is_super_admin:
        return jsonify({'error': 'Only super admins can update settings'}), 403
    
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'No email configuration data provided'}), 400
    
    # Log the received data for debugging
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f'Email settings data received: {data}')
    
    # Validate required fields
    required_fields = ['mail_server', 'mail_port', 'mail_username', 'mail_password', 'mail_from_email', 'mail_from_name']
    missing_fields = [field for field in required_fields if not data.get(field)]
    
    if missing_fields:
        error_msg = f'Missing required fields: {", ".join(missing_fields)}'
        logger.warning(f'Email settings validation failed: {error_msg}')
        return jsonify({'error': error_msg}), 422
    
    try:
        email_settings = {
            'MAIL_SERVER': str(data.get('mail_server', '')).strip(),
            'MAIL_PORT': str(int(data.get('mail_port', 587))),
            'MAIL_USE_TLS': str(data.get('mail_use_tls', True)).lower(),
            'MAIL_USERNAME': str(data.get('mail_username', '')).strip(),
            'MAIL_PASSWORD': str(data.get('mail_password', '')).strip(),
            'MAIL_FROM_EMAIL': str(data.get('mail_from_email', '')).strip(),
            'MAIL_FROM_NAME': str(data.get('mail_from_name', 'PostWave')).strip(),
        }
        logger.info(f'Email settings converted: {email_settings}')
    except (ValueError, TypeError) as e:
        error_msg = f'Invalid email configuration format: {str(e)}'
        logger.error(f'Email settings conversion error: {error_msg}')
        return jsonify({'error': error_msg}), 422
    
    for key, value in email_settings.items():
        setting = Settings.query.filter_by(key=key).first()
        
        if not setting:
            setting = Settings(
                key=key,
                value=value,
                setting_type=EDITABLE_SETTINGS[key]['type'],
                description=EDITABLE_SETTINGS[key]['description'],
                editable=True
            )
            db.session.add(setting)
        else:
            setting.value = value
            setting.updated_at = datetime.utcnow()
    
    try:
        db.session.commit()
        logger.info('Email settings saved successfully')
    except Exception as e:
        db.session.rollback()
        error_msg = f'Failed to save email settings: {str(e)}'
        logger.error(f'Email settings save error: {error_msg}')
        return jsonify({'error': error_msg}), 500
    
    return jsonify({
        'success': True,
        'message': 'Email settings saved successfully'
    }), 200


@settings_bp.route('/app-url', methods=['POST'])
@jwt_required()
def update_app_url():
    """Update application URL. Super admin only. Used during onboarding."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user or not user.is_super_admin:
        return jsonify({'error': 'Only super admins can update settings'}), 403
    
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'No application URL data provided'}), 400
    
    app_url = data.get('app_url', '').strip()
    
    if not app_url:
        return jsonify({'error': 'Application URL is required and cannot be empty'}), 422
    
    try:
        setting = Settings.query.filter_by(key='APP_HOST').first()
        
        if not setting:
            setting = Settings(
                key='APP_HOST',
                value=app_url,
                setting_type='string',
                description=EDITABLE_SETTINGS['APP_HOST']['description'],
                editable=True
            )
            db.session.add(setting)
        else:
            setting.value = app_url
            setting.updated_at = datetime.utcnow()
        
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Failed to save application URL: {str(e)}'}), 500
    
    return jsonify({
        'success': True,
        'message': 'Application URL saved successfully'
    }), 200

