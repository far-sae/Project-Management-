/**
 * Organization Settings Component
 * Allows organization owners and admins to manage organization settings
 */

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useOrganization } from '@/context/OrganizationContext';
import { updateOrganization } from '@/services/supabase/organizations';
import { toast } from 'sonner';
import { COUNTRIES, COMMON_CURRENCIES, currencyForCountry } from '@/lib/countries';

export const OrganizationSettings: React.FC = () => {
  const { organization, loading, refreshOrganization, canManageSettings } = useOrganization();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    country: '',
    timezone: 'UTC',
    currency: 'USD',
    locale: 'en',
    primaryColor: '',
    secondaryColor: '',
    aiEnabled: true,
    fileUploadsEnabled: true,
    advancedAnalytics: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (organization) {
      setFormData({
        name: organization.name,
        country: organization.country || '',
        timezone: organization.settings.timezone,
        currency: organization.settings.currency,
        locale: organization.settings.locale,
        primaryColor: organization.settings.branding.primaryColor || '',
        secondaryColor: organization.settings.branding.secondaryColor || '',
        aiEnabled: organization.settings.features.aiEnabled,
        fileUploadsEnabled: organization.settings.features.fileUploadsEnabled,
        advancedAnalytics: organization.settings.features.advancedAnalytics,
      });
    }
  }, [organization]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleToggleChange = (name: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!organization || !canManageSettings) return;

    setSaving(true);
    try {
      await updateOrganization(organization.organizationId, {
        name: formData.name,
        country: formData.country || undefined,
        settings: {
          timezone: formData.timezone,
          currency: formData.currency,
          locale: formData.locale,
          branding: {
            logoUrl: organization.settings.branding.logoUrl, // Keep existing logo
            primaryColor: formData.primaryColor,
            secondaryColor: formData.secondaryColor,
          },
          features: {
            aiEnabled: formData.aiEnabled,
            fileUploadsEnabled: formData.fileUploadsEnabled,
            advancedAnalytics: formData.advancedAnalytics,
          }
        }
      });

      await refreshOrganization();
      setIsEditing(false);
      toast.success('Success', {
        description: 'Organization settings updated successfully',
      });
    } catch (error) {
      console.error('Error updating organization:', error);
      toast.error('Error', {
        description: 'Failed to update organization settings',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="text-center py-8 text-gray-500">
        No organization found
      </div>
    );
  }

  if (!canManageSettings) {
    return (
      <div className="text-center py-8 text-gray-500">
        You don't have permission to manage organization settings
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization Settings</CardTitle>
          <CardDescription>Manage your organization's settings and preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Select
                    value={formData.country}
                    onValueChange={(value) => {
                      setFormData((prev) => {
                        const next = { ...prev, country: value };
                        // Auto-fill currency to match the picked country.
                        // Owners can still override below if they bill in a
                        // different currency than where they're based.
                        const inferred = currencyForCountry(value);
                        if (inferred) next.currency = inferred;
                        return next;
                      });
                    }}
                    disabled={!isEditing}
                  >
                    <SelectTrigger id="country">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name} ({c.currency})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sets the default currency for new expenses, contracts, and
                    payslips.
                  </p>
                </div>

                <div>
                  <Label htmlFor="currency">Currency</Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, currency: value }))
                    }
                    disabled={!isEditing}
                  >
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input
                    id="timezone"
                    name="timezone"
                    value={formData.timezone}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="locale">Locale</Label>
                <Input
                  id="locale"
                  name="locale"
                  value={formData.locale}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="primaryColor">Primary Color</Label>
                  <Input
                    id="primaryColor"
                    name="primaryColor"
                    value={formData.primaryColor}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    placeholder="#3B82F6"
                  />
                </div>

                <div>
                  <Label htmlFor="secondaryColor">Secondary Color</Label>
                  <Input
                    id="secondaryColor"
                    name="secondaryColor"
                    value={formData.secondaryColor}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    placeholder="#6B7280"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="aiEnabled">AI Features</Label>
                  <Switch
                    id="aiEnabled"
                    checked={formData.aiEnabled}
                    onCheckedChange={(checked) => handleToggleChange('aiEnabled', checked)}
                    disabled={!isEditing}
                  />
                </div>
                <p className="text-sm text-gray-500">Enable AI-powered features</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="fileUploadsEnabled">File Uploads</Label>
                  <Switch
                    id="fileUploadsEnabled"
                    checked={formData.fileUploadsEnabled}
                    onCheckedChange={(checked) => handleToggleChange('fileUploadsEnabled', checked)}
                    disabled={!isEditing}
                  />
                </div>
                <p className="text-sm text-gray-500">Allow file uploads and sharing</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="advancedAnalytics">Advanced Analytics</Label>
                  <Switch
                    id="advancedAnalytics"
                    checked={formData.advancedAnalytics}
                    onCheckedChange={(checked) => handleToggleChange('advancedAnalytics', checked)}
                    disabled={!isEditing}
                  />
                </div>
                <p className="text-sm text-gray-500">Enable advanced analytics features</p>
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              {!isEditing ? (
                <Button type="button" onClick={() => setIsEditing(true)}>
                  Edit Settings
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      // Reset form to original values
                      setFormData({
                        name: organization.name,
                        country: organization.country || '',
                        timezone: organization.settings.timezone,
                        currency: organization.settings.currency,
                        locale: organization.settings.locale,
                        primaryColor: organization.settings.branding.primaryColor || '',
                        secondaryColor: organization.settings.branding.secondaryColor || '',
                        aiEnabled: organization.settings.features.aiEnabled,
                        fileUploadsEnabled: organization.settings.features.fileUploadsEnabled,
                        advancedAnalytics: organization.settings.features.advancedAnalytics,
                      });
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};