"""Email utilities for sending invitations and notifications."""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import Config
import logging
import os

logger = logging.getLogger(__name__)


def get_app_url(default='http://localhost:5500'):
    """
    Get application URL from database or fallback to default.
    
    Args:
        default: Default URL if not found
    
    Returns:
        The application URL
    """
    try:
        from models import Settings
        # Try to get app_domain from settings
        setting = Settings.query.filter_by(key='app_domain').first()
        if setting and setting.value:
            # Ensure it has a protocol
            url = setting.value.strip()
            if not url.startswith('http://') and not url.startswith('https://'):
                url = f'https://{url}'
            return url
    except Exception as e:
        logger.debug(f'Could not load app_domain from database: {e}')
    
    # Fallback to environment/config
    env_value = os.getenv('APP_URL')
    if env_value:
        return env_value
    
    return default


def get_mail_config(key, default=None):
    """
    Get mail configuration from database (if available) or fallback to environment/config.
    
    Args:
        key: The setting key (e.g., 'MAIL_SERVER', 'MAIL_PORT')
        default: Default value if not found
    
    Returns:
        The configuration value
    """
    try:
        # Try to import and use database settings
        from models import Settings
        # Try both lowercase and uppercase versions
        setting = Settings.query.filter_by(key=key).first()
        if not setting:
            # Try lowercase version
            setting = Settings.query.filter_by(key=key.lower()).first()
        if not setting:
            # Try uppercase version
            setting = Settings.query.filter_by(key=key.upper()).first()
            
        if setting and setting.value:
            # Convert string values to appropriate types
            if 'port' in key.lower():
                return int(setting.value)
            elif 'tls' in key.lower():
                return setting.value.lower() in ('true', '1', 'yes')
            return setting.value
    except Exception as e:
        logger.debug(f'Could not load {key} from database: {e}')
    
    # Fallback to environment/config
    env_value = os.getenv(key)
    if env_value:
        if 'port' in key.lower():
            return int(env_value)
        elif 'tls' in key.lower():
            return env_value.lower() in ('true', '1', 'yes')
        return env_value
    
    # Fallback to Config class
    if hasattr(Config, key):
        return getattr(Config, key)
    
    return default



class EmailService:
    """Service for sending emails via SMTP"""
    
    @staticmethod
    def send_email(to_email, subject, html_content, text_content=None):
        """
        Send an email using SMTP.
        
        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML email body
            text_content: Plain text email body (optional)
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        # Get settings from database or fallback to config
        mail_server = get_mail_config('MAIL_SERVER')
        mail_port = get_mail_config('MAIL_PORT', 587)
        mail_use_tls = get_mail_config('MAIL_USE_TLS', True)
        mail_username = get_mail_config('MAIL_USERNAME')
        mail_password = get_mail_config('MAIL_PASSWORD')
        mail_from_email = get_mail_config('MAIL_FROM_EMAIL', 'noreply@postwave.com')
        mail_from_name = get_mail_config('MAIL_FROM_NAME', 'PostWave')
        
        if not mail_server:
            logger.warning('MAIL_SERVER not configured, email not sent')
            return False, 'Email service not configured'
        
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = f"{mail_from_name} <{mail_from_email}>"
            msg['To'] = to_email
            
            # Attach plain text and HTML versions
            if text_content:
                msg.attach(MIMEText(text_content, 'plain'))
            msg.attach(MIMEText(html_content, 'html'))
            
            # Send email
            with smtplib.SMTP(mail_server, mail_port) as server:
                if mail_use_tls:
                    server.starttls()
                
                if mail_username and mail_password:
                    server.login(mail_username, mail_password)
                
                server.send_message(msg)
            
            logger.info(f'Email sent successfully to {to_email}')
            return True, 'Email sent successfully'
        
        except Exception as e:
            logger.error(f'Failed to send email to {to_email}: {str(e)}', exc_info=True)
            return False, f'Failed to send email: {str(e)}'
    
    @staticmethod
    def send_invitation_email(to_email, invitation_token, inviter_name, team_name=None, base_url='http://localhost:5500'):
        """
        Send invitation email to a user.
        
        Args:
            to_email: Recipient email
            invitation_token: Unique token for acceptance link
            inviter_name: Name of person sending invitation
            team_name: Name of team (optional)
            base_url: Base URL for invitation link
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        invitation_link = f"{base_url}/accept-invite?token={invitation_token}"
        
        if team_name:
            subject = f"Join {team_name} on PostWave"
            message = f"You've been invited to join the <strong>{team_name}</strong> team on PostWave by <strong>{inviter_name}</strong>."
        else:
            subject = "You're invited to PostWave"
            message = f"You've been invited to join PostWave by <strong>{inviter_name}</strong>."
        
        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2>Welcome to PostWave!</h2>
                    <p>{message}</p>
                    <p>Click the button below to accept the invitation:</p>
                    <p>
                        <a href="{invitation_link}" style="background-color: #5865F2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Accept Invitation
                        </a>
                    </p>
                    <p>Or copy this link: <a href="{invitation_link}">{invitation_link}</a></p>
                    <p style="color: #999; font-size: 12px;">This invitation link expires in 7 days.</p>
                </div>
            </body>
        </html>
        """
        
        text_content = f"""
Welcome to PostWave!

{message}

Click the link below to accept the invitation:
{invitation_link}

This invitation link expires in 7 days.
        """
        
        return EmailService.send_email(to_email, subject, html_content, text_content)
    
    @staticmethod
    def send_registration_notification(to_email, new_user_name, inviter_name, team_name=None):
        """
        Send notification that a new user has registered.
        
        Args:
            to_email: Recipient email (inviter)
            new_user_name: Name of new user
            inviter_name: Name of inviter
            team_name: Team name (optional)
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        if team_name:
            subject = f"{new_user_name} joined {team_name} on PostWave"
            message = f"<strong>{new_user_name}</strong> has accepted your invitation and joined <strong>{team_name}</strong>."
        else:
            subject = f"{new_user_name} joined PostWave"
            message = f"<strong>{new_user_name}</strong> has accepted your invitation to join PostWave."
        
        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2>New Member Joined!</h2>
                    <p>{message}</p>
                </div>
            </body>
        </html>
        """
        
        text_content = f"New Member Joined!\n\n{message}"
        
        return EmailService.send_email(to_email, subject, html_content, text_content)
