/**
 * TradeGateway™ NGSWTP — React Native Navigation
 * Mirrors the PWA navigation structure with bottom tabs + stack navigation.
 * All screens connect to the same tRPC backend as the PWA.
 */
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createDrawerNavigator } from "@react-navigation/drawer";

// Auth screens
import LoginScreen from "../screens/auth/LoginScreen";
import BiometricScreen from "../screens/auth/BiometricScreen";

// Main screens (parity with PWA)
import DashboardScreen from "../screens/app/DashboardScreen";
import DeclarationsScreen from "../screens/app/DeclarationsScreen";
import DeclarationDetailScreen from "../screens/app/DeclarationDetailScreen";
import NewDeclarationScreen from "../screens/app/NewDeclarationScreen";
import PaymentsScreen from "../screens/app/PaymentsScreen";
import PaymentDetailScreen from "../screens/app/PaymentDetailScreen";
import CargoTrackingScreen from "../screens/app/CargoTrackingScreen";
import DocumentVaultScreen from "../screens/app/DocumentVaultScreen";
import ProfileScreen from "../screens/app/ProfileScreen";
import NotificationsScreen from "../screens/app/NotificationsScreen";
import OGAStatusScreen from "../screens/app/OGAStatusScreen";
import RiskScoreScreen from "../screens/app/RiskScoreScreen";
import SystemStatusScreen from "../screens/app/SystemStatusScreen";
import KYCScreen from "../screens/app/KYCScreen";
import AEOScreen from "../screens/app/AEOScreen";
import TraderScorecardScreen from "../screens/app/TraderScorecardScreen";
import HSCodeLookupScreen from "../screens/app/HSCodeLookupScreen";
import ScanDocumentScreen from "../screens/app/ScanDocumentScreen";

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Biometric: undefined;
};

export type MainDrawerParamList = {
  HomeTabs: undefined;
  Declarations: undefined;
  Payments: undefined;
  CargoTracking: undefined;
  DocumentVault: undefined;
  OGAStatus: undefined;
  KYC: undefined;
  AEO: undefined;
  TraderScorecard: undefined;
  SystemStatus: undefined;
  Profile: undefined;
};

export type HomeTabsParamList = {
  Dashboard: undefined;
  Declarations: undefined;
  Payments: undefined;
  CargoTracking: undefined;
  Notifications: undefined;
};

export type DeclarationsStackParamList = {
  DeclarationsList: undefined;
  DeclarationDetail: { declarationId: number };
  NewDeclaration: undefined;
  RiskScore: { declarationId: number };
  HSCodeLookup: undefined;
  ScanDocument: { declarationId?: number };
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainDrawer = createDrawerNavigator<MainDrawerParamList>();
const HomeTabs = createBottomTabNavigator<HomeTabsParamList>();
const DeclarationsStack = createNativeStackNavigator<DeclarationsStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Biometric" component={BiometricScreen} />
    </AuthStack.Navigator>
  );
}

function DeclarationsNavigator() {
  return (
    <DeclarationsStack.Navigator>
      <DeclarationsStack.Screen name="DeclarationsList" component={DeclarationsScreen} options={{ title: "Declarations" }} />
      <DeclarationsStack.Screen name="DeclarationDetail" component={DeclarationDetailScreen} options={{ title: "Declaration" }} />
      <DeclarationsStack.Screen name="NewDeclaration" component={NewDeclarationScreen} options={{ title: "New Declaration" }} />
      <DeclarationsStack.Screen name="RiskScore" component={RiskScoreScreen} options={{ title: "Risk Assessment" }} />
      <DeclarationsStack.Screen name="HSCodeLookup" component={HSCodeLookupScreen} options={{ title: "HS Code Lookup" }} />
      <DeclarationsStack.Screen name="ScanDocument" component={ScanDocumentScreen} options={{ title: "Scan Document" }} />
    </DeclarationsStack.Navigator>
  );
}

function HomeTabsNavigator() {
  return (
    <HomeTabs.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: "#0A1628", borderTopColor: "#1E3A5F" },
        tabBarActiveTintColor: "#D4A017",
        tabBarInactiveTintColor: "#6B7280",
        headerStyle: { backgroundColor: "#0A1628" },
        headerTintColor: "#FFFFFF",
      }}
    >
      <HomeTabs.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarLabel: "Dashboard" }} />
      <HomeTabs.Screen name="Declarations" component={DeclarationsNavigator} options={{ tabBarLabel: "Declarations", headerShown: false }} />
      <HomeTabs.Screen name="Payments" component={PaymentsScreen} options={{ tabBarLabel: "Payments" }} />
      <HomeTabs.Screen name="CargoTracking" component={CargoTrackingScreen} options={{ tabBarLabel: "Tracking" }} />
      <HomeTabs.Screen name="Notifications" component={NotificationsScreen} options={{ tabBarLabel: "Alerts" }} />
    </HomeTabs.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainDrawer.Navigator
      screenOptions={{
        drawerStyle: { backgroundColor: "#0A1628", width: 280 },
        drawerActiveTintColor: "#D4A017",
        drawerInactiveTintColor: "#9CA3AF",
        headerStyle: { backgroundColor: "#0A1628" },
        headerTintColor: "#FFFFFF",
      }}
    >
      <MainDrawer.Screen name="HomeTabs" component={HomeTabsNavigator} options={{ title: "TradeGateway", drawerLabel: "Home" }} />
      <MainDrawer.Screen name="Declarations" component={DeclarationsNavigator} options={{ title: "Declarations" }} />
      <MainDrawer.Screen name="Payments" component={PaymentsScreen} options={{ title: "Payments" }} />
      <MainDrawer.Screen name="CargoTracking" component={CargoTrackingScreen} options={{ title: "Cargo Tracking" }} />
      <MainDrawer.Screen name="DocumentVault" component={DocumentVaultScreen} options={{ title: "Document Vault" }} />
      <MainDrawer.Screen name="OGAStatus" component={OGAStatusScreen} options={{ title: "OGA Status" }} />
      <MainDrawer.Screen name="KYC" component={KYCScreen} options={{ title: "KYC Verification" }} />
      <MainDrawer.Screen name="AEO" component={AEOScreen} options={{ title: "AEO Programme" }} />
      <MainDrawer.Screen name="TraderScorecard" component={TraderScorecardScreen} options={{ title: "Trader Scorecard" }} />
      <MainDrawer.Screen name="SystemStatus" component={SystemStatusScreen} options={{ title: "System Status" }} />
      <MainDrawer.Screen name="Profile" component={ProfileScreen} options={{ title: "My Profile" }} />
    </MainDrawer.Navigator>
  );
}

export default function AppNavigator({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <RootStack.Screen name="Main" component={MainNavigator} />
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
